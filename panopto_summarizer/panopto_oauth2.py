"""
Panopto OAuth2 implementation for Authorization Code flow.
Based on Panopto's official documentation and examples.
"""

import os
import json
import logging
import requests
import urllib3
from urllib.parse import urlencode, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import time
from typing import Optional, Tuple, Dict
from pathlib import Path

logger = logging.getLogger(__name__)


class PanoptoOAuth2:
    """OAuth2 client for Panopto using Authorization Code flow with token persistence."""
    
    def __init__(self, server: str, client_id: str, client_secret: str, verify_ssl: bool = True, token_file: str = None):
        """
        Initialize OAuth2 client.
        
        Args:
            server: Panopto server FQDN (e.g., 'ncsu.hosted.panopto.com')
            client_id: OAuth2 client ID
            client_secret: OAuth2 client secret
            verify_ssl: Whether to verify SSL certificates
            token_file: Path to token storage file (default: .panopto_tokens.json)
        """
        self.server = server
        self.client_id = client_id
        self.client_secret = client_secret
        self.verify_ssl = verify_ssl
        
        # Set default token file path
        if token_file is None:
            token_file = Path.cwd() / '.panopto_tokens.json'
        self.token_file = Path(token_file)
        
        # OAuth2 endpoints
        self.auth_url = f"https://{server}/Panopto/oauth2/connect/authorize"
        self.token_url = f"https://{server}/Panopto/oauth2/connect/token"
        
        # OAuth2 state
        self.access_token = None
        self.refresh_token = None
        self.token_expires_at = None
        
        # Load existing tokens if available
        self._load_tokens()
        
        # Disable SSL warnings if needed
        if not verify_ssl:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    
    def _load_tokens(self) -> None:
        """Load saved tokens from disk if available."""
        try:
            if self.token_file.exists():
                with open(self.token_file, 'r') as f:
                    token_data = json.load(f)
                
                # Validate that the tokens are for the same client/server
                if (token_data.get('client_id') == self.client_id and 
                    token_data.get('server') == self.server):
                    
                    self.access_token = token_data.get('access_token')
                    self.refresh_token = token_data.get('refresh_token')
                    self.token_expires_at = token_data.get('expires_at')
                    
                    logger.info("Loaded saved tokens from disk")
                else:
                    logger.info("Saved tokens are for different client/server, ignoring")
                    # Remove invalid token file
                    self.token_file.unlink()
            else:
                logger.info("No saved tokens found")
                
        except Exception as e:
            logger.warning(f"Failed to load saved tokens: {e}")
            # Remove corrupted token file
            if self.token_file.exists():
                try:
                    self.token_file.unlink()
                except:
                    pass
    
    def _save_tokens(self) -> None:
        """Save tokens to disk for future use."""
        try:
            token_data = {
                'client_id': self.client_id,
                'server': self.server,
                'access_token': self.access_token,
                'refresh_token': self.refresh_token,
                'expires_at': self.token_expires_at,
                'saved_at': time.time()
            }
            
            # Ensure the directory exists
            self.token_file.parent.mkdir(parents=True, exist_ok=True)
            
            # Write tokens with restricted permissions
            with open(self.token_file, 'w') as f:
                json.dump(token_data, f, indent=2)
            
            # Set file permissions to be readable only by owner (Unix-like systems)
            try:
                os.chmod(self.token_file, 0o600)
            except:
                pass  # Windows doesn't support chmod the same way
            
            logger.info(f"Saved tokens to {self.token_file}")
            
        except Exception as e:
            logger.error(f"Failed to save tokens: {e}")
    
    def _clear_tokens(self) -> None:
        """Clear tokens from memory and disk."""
        self.access_token = None
        self.refresh_token = None
        self.token_expires_at = None
        
        try:
            if self.token_file.exists():
                self.token_file.unlink()
                logger.info("Cleared saved tokens from disk")
        except Exception as e:
            logger.warning(f"Failed to clear token file: {e}")
    
    def _is_token_valid(self, buffer_minutes: int = 5) -> bool:
        """
        Check if current access token is valid and not expired.
        
        Args:
            buffer_minutes: Safety buffer in minutes before expiry (default: 5)
            
        Returns:
            True if token is valid and not close to expiring
        """
        if not self.access_token:
            return False
        
        if not self.token_expires_at:
            return False
        
        # Use configurable buffer to prevent using tokens that expire soon
        buffer_seconds = buffer_minutes * 60
        return time.time() < (self.token_expires_at - buffer_seconds)
    
    def get_token_time_remaining(self) -> Optional[float]:
        """
        Get remaining time until token expires.
        
        Returns:
            Seconds until expiry, or None if no token
        """
        if not self.token_expires_at:
            return None
        
        remaining = self.token_expires_at - time.time()
        return max(0, remaining)
    
    def get_access_token_authorization_code_grant(self) -> str:
        """
        Get access token using Authorization Code grant flow with token persistence.
        
        Returns:
            Access token string
        """
        # Check if current token is valid (with a longer buffer for server deployment)
        if self._is_token_valid():
            logger.info("Using existing valid access token")
            return self.access_token
        
        # Try to refresh using saved refresh token (if available)
        if self.refresh_token:
            logger.info("Attempting to refresh access token using saved refresh token")
            if self._refresh_access_token():
                return self.access_token
            else:
                logger.info("Token refresh failed, will need to re-authorize")
                self._clear_tokens()
        else:
            # If we have an expired token but no refresh token, warn about server deployment
            if self.access_token and not self._is_token_valid():
                logger.warning("Access token expired and no refresh token available")
                logger.warning("For server deployment, consider:")
                logger.warning("1. Using longer-lived tokens if available")
                logger.warning("2. Setting up automated re-authentication")
                logger.warning("3. Running the script more frequently than token expiry")
        
        # Need to perform full authorization flow
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
        
        # Save tokens for future use
        self._save_tokens()
    
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
            
            # Save the refreshed tokens
            self._save_tokens()
            
            return True
            
        except Exception as e:
            logger.error(f"Token refresh failed: {e}")
            return False
    
    def get_access_token_client_credentials(self) -> str:
        """
        Get access token using Client Credentials grant flow (server-to-server).
        This flow doesn't require user interaction and is perfect for automation.
        
        Returns:
            Access token string
            
        Raises:
            Exception: If authentication fails
        """
        # Check if current token is valid
        if self._is_token_valid():
            logger.info("Using existing valid access token")
            return self.access_token
        
        logger.info("Attempting Client Credentials flow for server-to-server authentication")
        
        # Prepare Client Credentials request
        token_data = {
            'grant_type': 'client_credentials',
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'scope': 'api'
        }
        
        headers = {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        
        try:
            response = requests.post(
                self.token_url,
                data=token_data,
                headers=headers,
                verify=self.verify_ssl,
                timeout=30
            )
            
            if response.status_code == 200:
                token_response = response.json()
                
                self.access_token = token_response.get('access_token')
                self.token_type = token_response.get('token_type', 'Bearer')
                
                # Calculate expiry time
                expires_in = token_response.get('expires_in', 3600)  # Default 1 hour
                self.expires_at = time.time() + expires_in
                
                # Client credentials flow typically doesn't provide refresh tokens
                self.refresh_token = token_response.get('refresh_token')  # Usually None
                
                # Save tokens
                self._save_tokens()
                
                logger.info("Successfully obtained access token via Client Credentials")
                logger.info(f"Token expires in {expires_in} seconds ({expires_in/3600:.1f} hours)")
                
                if not self.refresh_token:
                    logger.info("No refresh token provided - will need to re-authenticate when token expires")
                
                return self.access_token
                
            else:
                error_msg = f"Client Credentials authentication failed: {response.status_code} {response.text}"
                logger.error(error_msg)
                raise Exception(error_msg)
                
        except requests.exceptions.RequestException as e:
            error_msg = f"Network error during Client Credentials authentication: {e}"
            logger.error(error_msg)
            raise Exception(error_msg)
        except Exception as e:
            error_msg = f"Client Credentials authentication error: {e}"
            logger.error(error_msg)
            raise Exception(error_msg)
    
    def get_access_token_auto(self, prefer_unattended: bool = False) -> str:
        """
        Automatically get access token using the best available method.
        
        Args:
            prefer_unattended: If True, tries Client Credentials first for server automation
            
        Returns:
            Access token string
        """
        # Check if current token is valid
        if self._is_token_valid():
            logger.info("Using existing valid access token")
            return self.access_token
        
        if prefer_unattended:
            # For server deployment, try Client Credentials first
            try:
                logger.info("Attempting unattended authentication via Client Credentials")
                return self.get_access_token_client_credentials()
            except Exception as e:
                logger.warning(f"Client Credentials failed: {e}")
                logger.info("Falling back to Authorization Code flow (requires user interaction)")
                return self.get_access_token_authorization_code_grant()
        else:
            # For interactive use, use Authorization Code flow
            return self.get_access_token_authorization_code_grant()
    
    def get_session_with_auth(self) -> requests.Session:
        """Get a requests session with proper authorization headers."""
        session = requests.Session()
        session.verify = self.verify_ssl
        
        # Get access token
        access_token = self.get_access_token_authorization_code_grant()
        
        # Set authorization header
        session.headers.update({'Authorization': f'Bearer {access_token}'})
        
        return session
    
    def is_suitable_for_server_deployment(self) -> Tuple[bool, str]:
        """
        Check if current token setup is suitable for server deployment.
        
        Returns:
            (is_suitable, reason) tuple
        """
        if not self.token_file.exists():
            return False, "No saved tokens found"
        
        if not self.access_token:
            return False, "No access token available"
        
        if not self.refresh_token:
            remaining_hours = self.get_token_time_remaining()
            if remaining_hours is None:
                return False, "Token expiry unknown"
            
            remaining_hours = remaining_hours / 3600
            if remaining_hours < 1:
                return False, f"Token expires in {remaining_hours:.1f} hours and no refresh token available"
            elif remaining_hours < 24:
                return False, f"Token expires in {remaining_hours:.1f} hours. Without refresh tokens, consider running more frequently"
            else:
                return True, f"Token valid for {remaining_hours:.1f} hours (no refresh token, but should work for server deployment with frequent runs)"
        else:
            return True, "Has refresh token - suitable for long-term server deployment"
    
    def generate_server_deployment_guide(self) -> str:
        """Generate a deployment guide for server usage."""
        is_suitable, reason = self.is_suitable_for_server_deployment()
        
        guide = "🚀 SERVER DEPLOYMENT GUIDE\n"
        guide += "=" * 50 + "\n\n"
        
        if is_suitable:
            guide += "✅ READY FOR SERVER DEPLOYMENT\n"
            guide += f"Reason: {reason}\n\n"
        else:
            guide += "⚠️ NOT OPTIMAL FOR SERVER DEPLOYMENT\n"
            guide += f"Issue: {reason}\n\n"
        
        guide += "DEPLOYMENT STRATEGIES:\n\n"
        
        guide += "1. 🔄 FREQUENT EXECUTION (Recommended)\n"
        guide += "   - Run script every 30-60 minutes\n"
        guide += "   - Tokens typically last 1-4 hours\n"
        guide += "   - Each run reuses valid tokens automatically\n"
        guide += "   - Minimal overhead when tokens are valid\n\n"
        
        guide += "2. 📅 SCHEDULED BATCH PROCESSING\n"
        guide += "   - Process multiple sessions in single run\n"
        guide += "   - Amortize authentication overhead\n"
        guide += "   - Example: Process daily lectures each morning\n\n"
        
        guide += "3. 🔧 TOKEN MONITORING\n"
        guide += "   - Use --token-status to check before runs\n"
        guide += "   - Set up alerts when tokens near expiry\n"
        guide += "   - Monitor logs for authentication issues\n\n"
        
        guide += "4. 🏠 LOCAL PROXY SERVER (Advanced)\n"
        guide += "   - Run script on local machine with browser access\n"
        guide += "   - Expose API endpoint for server calls\n"
        guide += "   - Server makes requests to local proxy\n\n"
        
        if not self.refresh_token:
            guide += "⚠️ NO REFRESH TOKENS DETECTED\n"
            guide += "Your Panopto server doesn't provide refresh tokens.\n"
            guide += "This means you'll need to re-authorize every few hours.\n"
            guide += "Consider strategies #1 or #4 above.\n\n"
        
        guide += "CRON EXAMPLE (Linux/Mac):\n"
        guide += "# Run every hour\n"
        guide += "0 * * * * cd /path/to/script && python main.py SESSION_ID\n\n"
        
        guide += "SCHEDULED TASK EXAMPLE (Windows):\n"
        guide += "- Open Task Scheduler\n"
        guide += "- Create Basic Task -> Hourly\n"
        guide += "- Action: Start Program\n"
        guide += "- Program: python\n"
        guide += "- Arguments: main.py SESSION_ID\n"
        guide += "- Start in: C:\\path\\to\\script\n\n"
        
        return guide
    
    def clear_stored_tokens(self) -> None:
        """
        Manually clear stored tokens. Useful for debugging or logout.
        Next authentication will require full authorization flow.
        """
        logger.info("Manually clearing stored tokens")
        self._clear_tokens()
    
    def get_token_status(self) -> Dict[str, any]:
        """
        Get current token status for debugging.
        
        Returns:
            Dictionary with token status information
        """
        return {
            'has_access_token': bool(self.access_token),
            'has_refresh_token': bool(self.refresh_token),
            'token_expires_at': self.token_expires_at,
            'is_token_valid': self._is_token_valid(),
            'token_file_exists': self.token_file.exists(),
            'seconds_until_expiry': (self.token_expires_at - time.time()) if self.token_expires_at else None
        }
