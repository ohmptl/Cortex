"""
Panopto OAuth2 implementation for Authorization Code flow.
Based on Panopto's official documentation and examples.
"""

import os
import logging
import requests
import urllib3
from urllib.parse import urlencode, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import time
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


class PanoptoOAuth2:
    """OAuth2 client for Panopto using Authorization Code flow."""
    
    def __init__(self, server: str, client_id: str, client_secret: str, verify_ssl: bool = True):
        """
        Initialize OAuth2 client.
        
        Args:
            server: Panopto server FQDN (e.g., 'ncsu.hosted.panopto.com')
            client_id: OAuth2 client ID
            client_secret: OAuth2 client secret
            verify_ssl: Whether to verify SSL certificates
        """
        self.server = server
        self.client_id = client_id
        self.client_secret = client_secret
        self.verify_ssl = verify_ssl
        
        # OAuth2 endpoints
        self.auth_url = f"https://{server}/Panopto/oauth2/connect/authorize"
        self.token_url = f"https://{server}/Panopto/oauth2/connect/token"
        
        # OAuth2 state
        self.access_token = None
        self.refresh_token = None
        self.token_expires_at = None
        
        # Disable SSL warnings if needed
        if not verify_ssl:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    
    def get_access_token_authorization_code_grant(self) -> str:
        """
        Get access token using Authorization Code grant flow.
        
        Returns:
            Access token string
        """
        if self.access_token and self.token_expires_at and time.time() < self.token_expires_at:
            logger.info("Using existing valid access token")
            return self.access_token
        
        if self.refresh_token:
            logger.info("Attempting to refresh access token")
            if self._refresh_access_token():
                return self.access_token
        
        logger.info("Starting new authorization flow")
        return self._perform_authorization_code_flow()
    
    def _perform_authorization_code_flow(self) -> str:
        """Perform the full authorization code flow."""
        # Generate authorization URL
        auth_params = {
            'response_type': 'code',
            'client_id': self.client_id,
            'redirect_uri': 'http://localhost:8081/callback',
            'scope': 'api',
            'state': 'panopto_auth'
        }
        
        auth_url = f"{self.auth_url}?{urlencode(auth_params)}"
        
        print(f"\n🔐 Please authorize the application:")
        print(f"1. Open this URL in your browser: {auth_url}")
        print("2. Log in with your Panopto credentials")
        print("3. Authorize the application")
        print("4. You'll be redirected to localhost:8081\n")
        
        # Start local server to receive callback
        code = self._start_callback_server()
        
        # Exchange code for tokens
        self._exchange_code_for_tokens(code)
        
        return self.access_token
    
    def _start_callback_server(self) -> str:
        """Start a local server to receive the OAuth callback."""
        callback_code = [None]
        
        class CallbackHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                logger.info(f"Callback received: {self.path}")
                
                if self.path.startswith('/callback'):
                    # Parse query parameters
                    query = self.path.split('?', 1)[1] if '?' in self.path else ''
                    logger.info(f"Query string: {query}")
                    params = parse_qs(query)
                    logger.info(f"Parsed params: {params}")
                    
                    if 'code' in params:
                        callback_code[0] = params['code'][0]
                        logger.info(f"Authorization code received: {params['code'][0][:20]}...")
                        self.send_response(200)
                        self.send_header('Content-type', 'text/html')
                        self.end_headers()
                        self.wfile.write(b"""
                        <html>
                        <body>
                        <h2>Authorization Successful!</h2>
                        <p>You can close this window and return to the terminal.</p>
                        <p>Authorization code received successfully!</p>
                        </body>
                        </html>
                        """)
                    elif 'error' in params:
                        error_msg = params.get('error', ['Unknown error'])[0]
                        error_description = params.get('error_description', [''])[0]
                        logger.error(f"Authorization error: {error_msg} - {error_description}")
                        self.send_response(400)
                        self.end_headers()
                        self.wfile.write(f"Authorization failed: {error_msg}".encode())
                    else:
                        logger.warning(f"No code or error in callback params: {params}")
                        self.send_response(400)
                        self.end_headers()
                        self.wfile.write(b"Authorization failed: No code received")
                else:
                    logger.info(f"Unexpected callback path: {self.path}")
                    self.send_response(404)
                    self.end_headers()
            
            def log_message(self, format, *args):
                # Suppress server log messages
                pass
        
        # Start server in a separate thread
        server = HTTPServer(('localhost', 8081), CallbackHandler)
        server_thread = threading.Thread(target=server.serve_forever)
        server_thread.daemon = True
        server_thread.start()
        
        logger.info("Started callback server on localhost:8081")
        logger.info(f"Waiting for callback at: http://localhost:8081/callback")
        logger.info(f"Expected redirect URI: http://localhost:8081/callback")
        
        # Wait for callback with timeout
        timeout = 300  # 5 minutes
        start_time = time.time()
        while callback_code[0] is None:
            if time.time() - start_time > timeout:
                logger.error("Callback timeout - no authorization code received")
                server.shutdown()
                server.server_close()
                raise Exception("OAuth2 callback timeout")
            time.sleep(0.1)
        
        # Stop server
        server.shutdown()
        server.server_close()
        
        logger.info("Received authorization code")
        return callback_code[0]
    
    def _exchange_code_for_tokens(self, code: str) -> None:
        """Exchange authorization code for access and refresh tokens."""
        token_data = {
            'grant_type': 'authorization_code',
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'code': code,
            'redirect_uri': 'http://localhost:8081/callback'
        }
        
        response = requests.post(
            self.token_url,
            data=token_data,
            verify=self.verify_ssl
        )
        
        if response.status_code != 200:
            logger.error(f"Token exchange failed: {response.status_code} - {response.text}")
            response.raise_for_status()
        
        token_response = response.json()
        
        self.access_token = token_response['access_token']
        self.refresh_token = token_response.get('refresh_token')
        
        # Calculate expiration time
        expires_in = token_response.get('expires_in', 3600)  # Default to 1 hour
        self.token_expires_at = time.time() + expires_in
        
        logger.info("Successfully obtained access token")
    
    def _refresh_access_token(self) -> bool:
        """Refresh the access token using refresh token."""
        if not self.refresh_token:
            return False
        
        token_data = {
            'grant_type': 'refresh_token',
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'refresh_token': self.refresh_token
        }
        
        try:
            response = requests.post(
                self.token_url,
                data=token_data,
                verify=self.verify_ssl
            )
            
            if response.status_code != 200:
                logger.warning(f"Token refresh failed: {response.status_code}")
                return False
            
            token_response = response.json()
            
            self.access_token = token_response['access_token']
            if 'refresh_token' in token_response:
                self.refresh_token = token_response['refresh_token']
            
            # Calculate expiration time
            expires_in = token_response.get('expires_in', 3600)
            self.token_expires_at = time.time() + expires_in
            
            logger.info("Successfully refreshed access token")
            return True
            
        except Exception as e:
            logger.error(f"Token refresh failed: {e}")
            return False
    
    def get_session_with_auth(self) -> requests.Session:
        """Get a requests session with proper authorization headers."""
        session = requests.Session()
        session.verify = self.verify_ssl
        
        # Get access token
        access_token = self.get_access_token_authorization_code_grant()
        
        # Set authorization header
        session.headers.update({'Authorization': f'Bearer {access_token}'})
        
        return session
