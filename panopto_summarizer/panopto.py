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
            # Get session details first for logging
            session_url = f"{self.base_url}/Panopto/api/v1/sessions/{session_id}"
            response = self.session.get(session_url)
            response.raise_for_status()
            
            session_data = response.json()
            logger.info(f"Retrieved session: {session_data.get('Name', 'Unknown')}")
            
            # Check basic caption availability
            if not self._has_captions_available(session_data):
                logger.warning(f"Session {session_id} may not have captions available")
            
            # Use direct SRT download (the method that works)
            caption_text = self._try_direct_srt_download(session_id)
            if caption_text:
                return caption_text
            
            # Fallback: try to extract from session data
            caption_text = self._extract_from_session_data(session_data)
            if caption_text:
                return caption_text
            
            logger.warning(f"Caption retrieval failed for session {session_id}")
            return None
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Request failed for session {session_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error getting captions for session {session_id}: {e}")
            return None
    
    def _has_captions_available(self, session_data: dict) -> bool:
        """
        Check if the session likely has captions available.
        
        Args:
            session_data: Session data from API
            
        Returns:
            True if captions might be available, False otherwise
        """
        try:
            # Check duration - very short sessions might not have captions
            duration = session_data.get('Duration', 0)
            if duration < 60:  # Less than 1 minute
                logger.info(f"Session is very short ({duration} seconds), may not have captions")
                return False
            
            # If we can't determine, assume captions might be available
            return True
            
        except Exception as e:
            logger.error(f"Error checking caption availability: {e}")
            return True  # Default to trying

    def _try_direct_srt_download(self, session_id: str) -> Optional[str]:
        """Try direct SRT download using the known working URL format."""
        try:
            # Construct the direct SRT download URL
            srt_url = f"{self.base_url}/Panopto/Pages/Transcription/GenerateSRT.ashx?id={session_id}&language=English_USA"
            logger.info(f"Trying direct SRT download: {srt_url}")
            
            # Get legacy authentication cookie
            legacy_cookie = self._get_legacy_auth_cookie()
            if not legacy_cookie:
                logger.error("Failed to get legacy authentication cookie")
                return None
            
            # Create session with legacy cookie and browser-like headers
            caption_session = requests.Session()
            caption_session.cookies.set('.ASPXAUTH', legacy_cookie, domain='ncsu.hosted.panopto.com')
            
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Referer': f"{self.base_url}/Panopto/Pages/Viewer.aspx?id={session_id}"
            }
            
            response = caption_session.get(srt_url, headers=headers)
            logger.info(f"Direct SRT download returned status {response.status_code}")
            
            if response.status_code == 200 and response.text.strip():
                caption_content = response.text.strip()
                logger.info(f"Successfully retrieved captions via direct SRT, content length: {len(caption_content)}")
                return self._parse_caption_content(caption_content)
            
            return None
            
        except Exception as e:
            logger.error(f"Direct SRT download failed: {e}")
            return None

    def _extract_from_session_data(self, session_data: dict) -> Optional[str]:
        """Try to extract captions from session data description field."""
        try:
            # Check if description contains substantial content
            description = session_data.get('Description', '').strip()
            if description and len(description) > 50:
                logger.info(f"Found description content: {len(description)} characters")
                return description
            
            logger.info("No substantial content found in session data")
            return None
            
        except Exception as e:
            logger.error(f"Failed to extract content from session data: {e}")
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
