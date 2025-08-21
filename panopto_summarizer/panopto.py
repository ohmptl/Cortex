"""
Panopto API client for fetching lecture captions.
Handles OAuth2 authentication and caption retrieval using Authorization Code flow.
"""

import os
import logging
import time
from typing import Optional
import requests
from urllib.parse import urlparse

from panopto_oauth2 import PanoptoOAuth2

logger = logging.getLogger(__name__)


class PanoptoClient:
    """Client for interacting with Panopto REST API."""
    
    def __init__(self, client_id: str, client_secret: str, base_url: str):
        """
        Initialize Panopto client.
        
        Args:
            client_id: OAuth2 client ID
            client_secret: OAuth2 client secret
            base_url: Panopto base URL (e.g., https://ncsu.hosted.panopto.com)
        """
        self.client_id = client_id
        self.client_secret = client_secret
        self.base_url = base_url.rstrip('/')
        
        # Extract server name from base URL
        parsed_url = urlparse(base_url)
        self.server = parsed_url.netloc
        
        # Initialize OAuth2 client
        self.oauth2 = PanoptoOAuth2(
            server=self.server,
            client_id=self.client_id,
            client_secret=self.client_secret
        )
        
        self.session = None
        
    def authenticate(self) -> bool:
        """
        Authenticate using OAuth2 Authorization Code flow.
        
        Returns:
            True if authentication successful, False otherwise
        """
        try:
            # Get authenticated session from OAuth2 client
            self.session = self.oauth2.get_session_with_auth()
            self.session.headers.update({'Content-Type': 'application/json'})
            
            logger.info("Successfully authenticated with Panopto API")
            return True
            
        except Exception as e:
            logger.error(f"Authentication failed: {e}")
            return False
    
    def get_captions(self, session_id: str) -> Optional[str]:
        """
        Fetch captions for a given session ID.
        
        Args:
            session_id: Panopto session ID
            
        Returns:
            Caption text as plain string, or None if failed
        """
        if not self.session:
            if not self.authenticate():
                return None
        
        try:
            # First, get the session details to find caption information
            session_url = f"{self.base_url}/Panopto/api/v1/sessions/{session_id}"
            response = self.session.get(session_url)
            response.raise_for_status()
            
            session_data = response.json()
            logger.info(f"Retrieved session: {session_data.get('Name', 'Unknown')}")
            
            # Try multiple approaches to get captions
            caption_text = None
            
            # Approach 1: Try the official Panopto API endpoints first
            caption_text = self._try_api_endpoints(session_id)
            if caption_text:
                return caption_text
            
            # Approach 2: Try the legacy caption download URL
            caption_text = self._try_legacy_download(session_data, session_id)
            if caption_text:
                return caption_text
            
            # Approach 3: Try to get captions from session data directly
            caption_text = self._extract_from_session_data(session_data)
            if caption_text:
                return caption_text
            
            logger.warning(f"All caption retrieval methods failed for session {session_id}")
            return None
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Request failed for session {session_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error getting captions for session {session_id}: {e}")
            return None
    
    def _try_api_endpoints(self, session_id: str) -> Optional[str]:
        """Try official Panopto API endpoints for captions."""
        # Try different API endpoints that might contain captions
        api_endpoints = [
            f"{self.base_url}/Panopto/api/v1/sessions/{session_id}/captions",
            f"{self.base_url}/Panopto/api/v1/sessions/{session_id}/transcript",
            f"{self.base_url}/Panopto/api/v1/sessions/{session_id}/transcripts",
            f"{self.base_url}/Panopto/api/v1/sessions/{session_id}/captions/download",
            f"{self.base_url}/Panopto/api/v1/sessions/{session_id}/transcript/download",
            # Try different API versions
            f"{self.base_url}/Panopto/api/v2/sessions/{session_id}/captions",
            f"{self.base_url}/Panopto/api/v2/sessions/{session_id}/transcript"
        ]
        
        for endpoint in api_endpoints:
            try:
                logger.info(f"Trying API endpoint: {endpoint}")
                
                # Try GET first
                response = self.session.get(endpoint)
                logger.info(f"GET {endpoint} returned status {response.status_code}")
                
                if response.status_code == 200 and response.text.strip():
                    logger.info(f"Successfully retrieved captions from API endpoint: {endpoint}")
                    return self._parse_caption_content(response.text)
                
                # Try POST if GET fails
                if response.status_code == 405:  # Method Not Allowed
                    logger.info(f"Trying POST for {endpoint}")
                    
                    # Try POST with different request bodies
                    post_attempts = [
                        {},  # Empty body
                        {'format': 'srt'},  # Request SRT format
                        {'format': 'vtt'},  # Request VTT format
                        {'language': 'en'},  # Request English language
                        {'includeTimestamps': False},  # Request without timestamps
                        {'format': 'srt', 'language': 'en', 'includeTimestamps': False}  # Combined
                    ]
                    
                    for post_data in post_attempts:
                        try:
                            logger.info(f"Trying POST with data: {post_data}")
                            response = self.session.post(endpoint, json=post_data)
                            logger.info(f"POST {endpoint} with {post_data} returned status {response.status_code}")
                            
                            if response.status_code == 200 and response.text.strip():
                                logger.info(f"Successfully retrieved captions using POST: {endpoint}")
                                return self._parse_caption_content(response.text)
                            elif response.status_code == 429:  # Rate limited
                                logger.info(f"Rate limited (429), waiting before next attempt...")
                                time.sleep(2)  # Wait 2 seconds before next attempt
                                continue
                            elif response.status_code != 500:  # Log non-500 responses for debugging
                                logger.info(f"POST response: {response.text[:200]}...")
                        except Exception as e:
                            logger.info(f"POST with {post_data} failed: {e}")
                            continue
                
            except Exception as e:
                logger.info(f"Endpoint {endpoint} failed: {e}")
                continue
        
        return None
    
    def _try_legacy_download(self, session_data: dict, session_id: str) -> Optional[str]:
        """Try the legacy caption download URL approach."""
        try:
            # Check if the session has captions available via the CaptionDownloadUrl
            urls = session_data.get('Urls', {})
            caption_download_url = urls.get('CaptionDownloadUrl')
            
            if not caption_download_url:
                logger.info("No caption download URL available in session data")
                return None
            
            logger.info(f"Found caption download URL: {caption_download_url}")
            
            # Get legacy authentication cookie for the caption download endpoint
            legacy_cookie = self._get_legacy_auth_cookie()
            if not legacy_cookie:
                logger.error("Failed to get legacy authentication cookie")
                return None
            
            # Create a new session with the legacy cookie for caption download
            caption_session = requests.Session()
            caption_session.cookies.set('ASPXAUTH', legacy_cookie, domain='ncsu.hosted.panopto.com')
            
            # Try different approaches for the legacy URL
            caption_content = None
            
            # Try GET first
            try:
                caption_response = caption_session.get(caption_download_url)
                caption_response.raise_for_status()
                caption_content = caption_response.text
                logger.info(f"Legacy GET successful, content length: {len(caption_content)}")
            except Exception as e:
                logger.info(f"Legacy GET failed: {e}")
            
            # Try POST if GET fails or returns empty content
            if not caption_content or not caption_content.strip():
                try:
                    logger.info("Trying POST for legacy caption download")
                    caption_response = caption_session.post(caption_download_url)
                    caption_response.raise_for_status()
                    caption_content = caption_response.text
                    logger.info(f"Legacy POST successful, content length: {len(caption_content)}")
                except Exception as e:
                    logger.info(f"Legacy POST failed: {e}")
            
            # Try with additional headers that might be required
            if not caption_content or not caption_content.strip():
                try:
                    logger.info("Trying with additional headers")
                    headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Accept-Encoding': 'gzip, deflate',
                        'Referer': f"{self.base_url}/Panopto/Pages/Viewer.aspx?id={session_id}"
                    }
                    caption_response = caption_session.get(caption_download_url, headers=headers)
                    caption_response.raise_for_status()
                    caption_content = caption_response.text
                    logger.info(f"Legacy GET with headers successful, content length: {len(caption_content)}")
                except Exception as e:
                    logger.info(f"Legacy GET with headers failed: {e}")
            
            # Try with language parameter if the URL doesn't have it
            if not caption_content or not caption_content.strip():
                try:
                    logger.info("Trying with explicit language parameter")
                    if 'language=' not in caption_download_url:
                        # Add language parameter to the URL
                        separator = '&' if '?' in caption_download_url else '?'
                        url_with_language = f"{caption_download_url}{separator}language=English_USA"
                        logger.info(f"Trying URL with language: {url_with_language}")
                        
                        caption_response = caption_session.get(url_with_language, headers=headers)
                        caption_response.raise_for_status()
                        caption_content = caption_response.text
                        logger.info(f"Legacy GET with language parameter successful, content length: {len(caption_content)}")
                    else:
                        logger.info("URL already contains language parameter")
                except Exception as e:
                    logger.info(f"Legacy GET with language parameter failed: {e}")
            
            # Try with different language codes
            if not caption_content or not caption_content.strip():
                try:
                    logger.info("Trying different language codes")
                    languages = ['English', 'en', 'en-US', 'en_US']
                    
                    for lang in languages:
                        try:
                            separator = '&' if '?' in caption_download_url else '?'
                            url_with_lang = f"{caption_download_url}{separator}language={lang}"
                            logger.info(f"Trying language: {lang}")
                            
                            caption_response = caption_session.get(url_with_lang, headers=headers)
                            caption_response.raise_for_status()
                            caption_content = caption_response.text
                            
                            if caption_content and caption_content.strip():
                                logger.info(f"Successfully retrieved captions with language {lang}, content length: {len(caption_content)}")
                                break
                            else:
                                logger.info(f"Language {lang} returned empty content")
                        except Exception as e:
                            logger.info(f"Language {lang} failed: {e}")
                            continue
                            
                except Exception as e:
                    logger.info(f"Language parameter approach failed: {e}")
            
            if not caption_content or not caption_content.strip():
                logger.warning(f"All legacy download methods failed for session {session_id}")
                return None
            
            # Parse the caption content
            caption_text = self._parse_caption_content(caption_content)
            if caption_text and caption_text.strip():
                logger.info(f"Successfully retrieved captions via legacy download for session {session_id}")
                return caption_text.strip()
            
            return None
            
        except Exception as e:
            logger.error(f"Legacy download approach failed: {e}")
            return None
    
    def _extract_from_session_data(self, session_data: dict) -> Optional[str]:
        """Try to extract captions directly from session data."""
        try:
            # Log the structure of session data for debugging
            logger.info(f"Session data keys: {list(session_data.keys())}")
            
            # Log the actual values for key fields
            for key in ['Description', 'Content', 'Summary', 'Transcript']:
                if key in session_data:
                    value = session_data[key]
                    if isinstance(value, str):
                        logger.info(f"Field '{key}' (string): '{value[:100]}{'...' if len(value) > 100 else ''}'")
                    else:
                        logger.info(f"Field '{key}' (type {type(value)}): {value}")
                else:
                    logger.info(f"Field '{key}': not present")
            
            # Check if captions are embedded in the session data
            if 'Captions' in session_data:
                captions = session_data['Captions']
                logger.info(f"Captions field type: {type(captions)}")
                if isinstance(captions, list) and captions:
                    logger.info(f"Found {len(captions)} captions in session data")
                    caption_text = ""
                    for i, caption in enumerate(captions[:3]):  # Log first 3 captions
                        logger.info(f"Caption {i}: {caption}")
                        if isinstance(caption, dict) and 'Text' in caption:
                            caption_text += caption['Text'] + " "
                    if caption_text.strip():
                        logger.info(f"Successfully extracted captions from session data")
                        return caption_text.strip()
                elif isinstance(captions, dict):
                    logger.info(f"Captions is a dict with keys: {list(captions.keys())}")
                    if 'Text' in captions:
                        return str(captions['Text']).strip()
            
            # Check other possible fields
            for field in ['Transcript', 'CaptionText', 'Content', 'Description', 'Summary']:
                if field in session_data and session_data[field]:
                    logger.info(f"Found content in session data field: {field}")
                    content = str(session_data[field])
                    logger.info(f"Content preview: {content[:200]}...")
                    logger.info(f"Content length: {len(content.strip())} characters")
                    if len(content.strip()) > 50:  # Only return if substantial content
                        logger.info(f"Returning content from field: {field}")
                        return content.strip()
                    else:
                        logger.info(f"Field {field} content too short, skipping")
                else:
                    logger.info(f"Field {field}: {'empty' if field in session_data else 'not present'}")
            
            # Check if there are any URL fields that might contain captions
            urls = session_data.get('Urls', {})
            logger.info(f"URL fields: {list(urls.keys())}")
            
            # Check if there are any other fields that might contain text
            text_fields = []
            for key, value in session_data.items():
                if isinstance(value, str) and len(value) > 100:  # Look for long text fields
                    text_fields.append(key)
            
            if text_fields:
                logger.info(f"Potential text fields: {text_fields}")
                for field in text_fields:
                    content = str(session_data[field])
                    logger.info(f"Field '{field}' content preview: {content[:200]}...")
                    if any(word in content.lower() for word in ['lecture', 'class', 'course', 'topic', 'discussion']):
                        logger.info(f"Field '{field}' appears to contain lecture content")
                        return content.strip()
            
            logger.info("No captions found in session data")
            return None
            
        except Exception as e:
            logger.error(f"Failed to extract captions from session data: {e}")
            return None
    
    def _get_legacy_auth_cookie(self) -> Optional[str]:
        """
        Get a legacy authentication cookie for use with legacy endpoints.
        
        Returns:
            Legacy authentication cookie value, or None if failed
        """
        try:
            legacy_auth_url = f"{self.base_url}/Panopto/api/v1/auth/legacyLogin"
            logger.info(f"Requesting legacy auth from: {legacy_auth_url}")
            
            response = self.session.get(legacy_auth_url)
            logger.info(f"Legacy auth response status: {response.status_code}")
            
            response.raise_for_status()
            
            # Extract the ASPXAUTH cookie from the Set-Cookie header
            set_cookie_header = response.headers.get('Set-Cookie', '')
            logger.info(f"Set-Cookie header: {set_cookie_header[:100]}...")
            
            # Parse the ASPXAUTH cookie value
            asp_cookie = None
            for cookie_part in set_cookie_header.split(','):
                if '.ASPXAUTH=' in cookie_part:
                    # Extract the cookie value (everything between = and ;)
                    asp_cookie = cookie_part.split('.ASPXAUTH=')[1].split(';')[0]
                    break
            
            if not asp_cookie:
                logger.error("Could not find ASPXAUTH cookie in response headers")
                return None
            
            logger.info(f"Successfully extracted ASPXAUTH cookie: {asp_cookie[:50]}...")
            return asp_cookie
            
        except Exception as e:
            logger.error(f"Failed to get legacy authentication cookie: {e}")
            return None
    
    def _parse_caption_content(self, caption_content: str) -> str:
        """
        Parse caption content from various formats (SRT, VTT, plain text).
        
        Args:
            caption_content: Raw caption content
            
        Returns:
            Clean caption text without timestamps
        """
        lines = caption_content.strip().split('\n')
        caption_text = ""
        
        for line in lines:
            line = line.strip()
            
            # Skip empty lines
            if not line:
                continue
            
            # Skip timestamp lines (common patterns)
            # SRT format: 00:00:00,000 --> 00:00:05,000
            # VTT format: 00:00:00.000 --> 00:00:05.000
            if ('-->' in line and 
                (line.count(':') >= 2 or line.count('.') >= 1)):
                continue
            
            # Skip sequence numbers (SRT format)
            if line.isdigit():
                continue
            
            # Skip WebVTT header
            if line == 'WEBVTT':
                continue
            
            # Add non-timestamp lines to caption text
            caption_text += line + " "
        
        return caption_text
    
    def get_session_info(self, session_id: str) -> Optional[dict]:
        """
        Get basic session information.
        
        Args:
            session_id: Panopto session ID
            
        Returns:
            Session information dictionary, or None if failed
        """
        if not self.session:
            if not self.authenticate():
                return None
        
        try:
            session_url = f"{self.base_url}/Panopto/api/v1/sessions/{session_id}"
            response = self.session.get(session_url)
            response.raise_for_status()
            
            return response.json()
            
        except Exception as e:
            logger.error(f"Failed to get session info for {session_id}: {e}")
            return None
