#!/usr/bin/env python3
"""
Example script demonstrating how to use the Panopto Summarizer components.
This script shows how to use the clients programmatically.
"""

import logging
from config import Config
from panopto import PanoptoClient
from llm import GeminiClient


def setup_logging():
    """Setup basic logging."""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )


def example_usage():
    """Demonstrate basic usage of the clients."""
    print("🚀 Panopto Summarizer - Example Usage")
    print("=" * 50)
    
    try:
        # Load configuration
        print("1. Loading configuration...")
        config = Config()
        
        if not config.is_valid():
            print("❌ Configuration is invalid. Please run: python main.py --setup")
            return
        
        print("✅ Configuration loaded successfully")
        
        # Initialize Panopto client
        print("\n2. Initializing Panopto client...")
        panopto_config = config.get_panopto_config()
        panopto_client = PanoptoClient(
            client_id=panopto_config['client_id'],
            client_secret=panopto_config['client_secret'],
            base_url=panopto_config['base_url']
        )
        print("✅ Panopto client initialized")
        
        # Initialize Gemini client
        print("\n3. Initializing Gemini client...")
        gemini_config = config.get_gemini_config()
        gemini_client = GeminiClient(api_key=gemini_config['api_key'])
        print("✅ Gemini client initialized")
        
        # Show client information
        print("\n4. Client Information:")
        print(f"   Panopto Base URL: {panopto_config['base_url']}")
        print(f"   Gemini Model: {gemini_client.model.model_name}")
        
        # Example of getting model info
        model_info = gemini_client.get_model_info()
        print(f"   Gemini Config: Temperature={model_info['generation_config']['temperature']}")
        
        print("\n✅ Example completed successfully!")
        print("\n💡 To use with actual data:")
        print("   python main.py YOUR_SESSION_ID")
        
    except Exception as e:
        print(f"❌ Example failed: {e}")
        print("\n🔧 Please check your configuration:")
        print("   python main.py --config-status")


def example_with_mock_data():
    """Demonstrate summarization with mock data."""
    print("\n🔬 Testing with Mock Data")
    print("=" * 30)
    
    try:
        # Load configuration for Gemini
        config = Config()
        gemini_config = config.get_gemini_config()
        gemini_client = GeminiClient(api_key=gemini_config['api_key'])
        
        # Mock lecture transcript
        mock_transcript = """
        Welcome to today's lecture on machine learning fundamentals. 
        Today we'll be covering supervised learning, unsupervised learning, 
        and reinforcement learning. Let's start with supervised learning, 
        which involves training a model on labeled data. The model learns 
        to map inputs to outputs based on examples. Next, we'll discuss 
        unsupervised learning, where the model finds patterns in unlabeled data. 
        Finally, we'll cover reinforcement learning, where an agent learns 
        through trial and error with rewards and penalties.
        """
        
        print("📝 Mock transcript loaded")
        print(f"   Length: {len(mock_transcript)} characters")
        
        # Generate summary
        print("\n🤖 Generating summary...")
        summary = gemini_client.summarize_text(mock_transcript)
        
        if summary:
            print("✅ Summary generated successfully!")
            print(f"   Summary length: {len(summary)} characters")
            print("\n📋 Summary:")
            print("-" * 40)
            print(summary)
            print("-" * 40)
        else:
            print("❌ Failed to generate summary")
            
    except Exception as e:
        print(f"❌ Mock data test failed: {e}")


if __name__ == "__main__":
    setup_logging()
    
    # Run basic example
    example_usage()
    
    # Run mock data example
    example_with_mock_data()
