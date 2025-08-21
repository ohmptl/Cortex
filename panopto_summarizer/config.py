"""
Configuration utilities for Panopto Summarizer.
Handles environment variable loading, validation, and default values.
"""

import os
from typing import Dict, Optional
from dotenv import load_dotenv


class Config:
    """Configuration manager for the application."""
    
    def __init__(self, env_file: str = ".env"):
        """
        Initialize configuration.
        
        Args:
            env_file: Path to environment file
        """
        self.env_file = env_file
        self._load_env()
    
    def _load_env(self) -> None:
        """Load environment variables from .env file."""
        if os.path.exists(self.env_file):
            load_dotenv(self.env_file)
        else:
            # Try to load from current directory
            load_dotenv()
    
    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """
        Get environment variable value.
        
        Args:
            key: Environment variable name
            default: Default value if not found
            
        Returns:
            Environment variable value or default
        """
        return os.getenv(key, default)
    
    def get_required(self, key: str) -> str:
        """
        Get required environment variable value.
        
        Args:
            key: Environment variable name
            
        Returns:
            Environment variable value
            
        Raises:
            ValueError: If variable is not set
        """
        value = self.get(key)
        if not value:
            raise ValueError(f"Required environment variable {key} is not set")
        return value
    
    def validate_config(self) -> Dict[str, bool]:
        """
        Validate that all required configuration is present.
        
        Returns:
            Dictionary mapping config keys to validation status
        """
        required_vars = [
            'PANOPTO_CLIENT_ID',
            'PANOPTO_CLIENT_SECRET',
            'PANOPTO_BASE_URL',
            'GEMINI_API_KEY'
        ]
        
        validation_results = {}
        
        for var in required_vars:
            try:
                value = self.get_required(var)
                validation_results[var] = bool(value and value.strip())
            except ValueError:
                validation_results[var] = False
        
        return validation_results
    
    def is_valid(self) -> bool:
        """
        Check if all required configuration is valid.
        
        Returns:
            True if all required config is present and valid
        """
        validation_results = self.validate_config()
        return all(validation_results.values())
    
    @property
    def panopto_client_id(self) -> str:
        """Get Panopto client ID."""
        return self.get_required('PANOPTO_CLIENT_ID')
    
    @property
    def panopto_client_secret(self) -> str:
        """Get Panopto client secret."""
        return self.get_required('PANOPTO_CLIENT_SECRET')
    
    @property
    def panopto_base_url(self) -> str:
        """Get Panopto base URL."""
        return self.get_required('PANOPTO_BASE_URL')
    
    @property
    def gemini_api_key(self) -> str:
        """Get Gemini API key."""
        return self.get_required('GEMINI_API_KEY')
    
    def get_panopto_config(self) -> Dict[str, str]:
        """
        Get Panopto-specific configuration.
        
        Returns:
            Dictionary with Panopto configuration
            
        Raises:
            ValueError: If required Panopto config is missing
        """
        return {
            'client_id': self.get_required('PANOPTO_CLIENT_ID'),
            'client_secret': self.get_required('PANOPTO_CLIENT_SECRET'),
            'base_url': self.get_required('PANOPTO_BASE_URL')
        }
    
    def get_gemini_config(self) -> Dict[str, str]:
        """
        Get Gemini-specific configuration.
        
        Returns:
            Dictionary with Gemini configuration
            
        Raises:
            ValueError: If required Gemini config is missing
        """
        return {
            'api_key': self.get_required('GEMINI_API_KEY')
        }
    
    def print_config_status(self) -> None:
        """Print current configuration status."""
        print("🔧 Configuration Status")
        print("=" * 40)
        
        validation_results = self.validate_config()
        
        for var, is_valid in validation_results.items():
            status = "✅" if is_valid else "❌"
            value = self.get(var, "NOT SET")
            if is_valid and var in ['PANOPTO_CLIENT_SECRET', 'GEMINI_API_KEY']:
                value = f"{value[:8]}..." if len(value) > 8 else "***"
            print(f"{status} {var}: {value}")
        
        print(f"\nOverall Status: {'✅ Valid' if self.is_valid() else '❌ Invalid'}")


def create_env_template() -> str:
    """
    Create a template for the .env file.
    
    Returns:
        Template string for .env file
    """
    return """# Panopto OAuth2 Configuration
PANOPTO_CLIENT_ID=your_client_id_here
PANOPTO_CLIENT_SECRET=your_client_secret_here
PANOPTO_BASE_URL=https://your-institution.hosted.panopto.com

# Google Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: Logging Level (DEBUG, INFO, WARNING, ERROR)
# LOG_LEVEL=INFO
"""


def setup_env_file(env_file: str = ".env") -> bool:
    """
    Set up the .env file if it doesn't exist.
    
    Args:
        env_file: Path to .env file
        
    Returns:
        True if file was created, False if it already exists
    """
    if os.path.exists(env_file):
        print(f"⚠️  {env_file} already exists")
        return False
    
    try:
        template = create_env_template()
        with open(env_file, 'w') as f:
            f.write(template)
        
        print(f"✅ Created {env_file} with template values")
        print("💡 Please edit the file with your actual credentials")
        return True
        
    except Exception as e:
        print(f"❌ Failed to create {env_file}: {e}")
        return False
