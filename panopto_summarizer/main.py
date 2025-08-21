#!/usr/bin/env python3
"""
Main script for Panopto Lecture Summarizer.
Fetches lecture captions from Panopto and generates summaries using Google Gemini.
"""

import os
import sys
import logging
import argparse
from pathlib import Path

from panopto import PanoptoClient
from llm import GeminiClient
from config import Config


def setup_logging(level: str = "INFO") -> None:
    """Setup logging configuration."""
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler('panopto_summarizer.log')
        ]
    )


def load_environment() -> Config:
    """Load and validate environment configuration."""
    config = Config()
    
    if not config.is_valid():
        missing_vars = [var for var, valid in config.validate_config().items() if not valid]
        raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")
    
    return config


def get_captions(session_id: str, panopto_client: PanoptoClient) -> str:
    """
    Fetch captions for a given session ID.
    
    Args:
        session_id: Panopto session ID
        panopto_client: Initialized Panopto client
        
    Returns:
        Caption text as plain string
        
    Raises:
        RuntimeError: If captions cannot be retrieved
    """
    logger = logging.getLogger(__name__)
    
    logger.info(f"Fetching captions for session: {session_id}")
    
    # Get session info first
    session_info = panopto_client.get_session_info(session_id)
    if session_info:
        logger.info(f"Session: {session_info.get('Name', 'Unknown')}")
        logger.info(f"Duration: {session_info.get('Duration', 'Unknown')} seconds")
    
    # Get captions
    captions = panopto_client.get_captions(session_id)
    
    if not captions:
        raise RuntimeError(f"Failed to retrieve captions for session {session_id}")
    
    logger.info(f"Retrieved {len(captions)} characters of caption text")
    return captions


def summarize_text(text: str, gemini_client: GeminiClient) -> str:
    """
    Generate a summary of the provided text using Gemini.
    
    Args:
        text: Text to summarize
        gemini_client: Initialized Gemini client
        
    Returns:
        Generated summary as string
        
    Raises:
        RuntimeError: If summarization fails
    """
    logger = logging.getLogger(__name__)
    
    logger.info("Generating summary using Gemini...")
    
    summary = gemini_client.summarize_text(text)
    
    if not summary:
        raise RuntimeError("Failed to generate summary using Gemini")
    
    logger.info(f"Generated summary with {len(summary)} characters")
    return summary


def save_summary(summary: str, output_file: str = "summary.txt") -> None:
    """
    Save the summary to a text file.
    
    Args:
        summary: Summary text to save
        output_file: Output file path
    """
    logger = logging.getLogger(__name__)
    
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(summary)
        
        logger.info(f"Summary saved to {output_file}")
        
    except Exception as e:
        logger.error(f"Failed to save summary to {output_file}: {e}")
        raise


def main():
    """Main function."""
    parser = argparse.ArgumentParser(
        description="Panopto Lecture Summarizer - Fetch captions and generate summaries"
    )
    parser.add_argument(
        "session_id",
        nargs="?",
        help="Panopto session ID to process"
    )
    parser.add_argument(
        "--output", "-o",
        default="summary.txt",
        help="Output file for summary (default: summary.txt)"
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging level (default: INFO)"
    )
    parser.add_argument(
        "--setup",
        action="store_true",
        help="Set up environment configuration"
    )
    parser.add_argument(
        "--config-status",
        action="store_true",
        help="Show configuration status"
    )
    
    args = parser.parse_args()
    
    # Handle setup and config commands
    if args.setup:
        from config import setup_env_file
        setup_env_file()
        return
    
    if args.config_status:
        config = Config()
        config.print_config_status()
        return
    
    # Require session_id for main functionality
    if not args.session_id:
        parser.print_help()
        print("\n❌ Error: session_id is required for caption fetching and summarization")
        print("💡 Use --setup to configure environment or --config-status to check configuration")
        sys.exit(1)
    
    # Setup logging
    setup_logging(args.log_level)
    logger = logging.getLogger(__name__)
    
    try:
        logger.info("Starting Panopto Lecture Summarizer")
        
        # Load environment variables
        env_vars = load_environment()
        logger.info("Environment variables loaded successfully")
        
        # Initialize clients
        panopto_client = PanoptoClient(
            client_id=env_vars.get_required('PANOPTO_CLIENT_ID'),
            client_secret=env_vars.get_required('PANOPTO_CLIENT_SECRET'),
            base_url=env_vars.get_required('PANOPTO_BASE_URL')
        )
        
        gemini_client = GeminiClient(
            api_key=env_vars.get_required('GEMINI_API_KEY')
        )
        
        logger.info("Clients initialized successfully")
        
        # Fetch captions
        captions = get_captions(args.session_id, panopto_client)
        
        # Generate summary
        summary = summarize_text(captions, gemini_client)
        
        # Save summary
        save_summary(summary, args.output)
        
        logger.info("Process completed successfully!")
        print(f"\n✅ Summary generated and saved to: {args.output}")
        print(f"📝 Session ID: {args.session_id}")
        print(f"📊 Caption length: {len(captions)} characters")
        print(f"📋 Summary length: {len(summary)} characters")
        
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        print(f"❌ Configuration error: {e}")
        print("Please check your .env file and ensure all required variables are set.")
        sys.exit(1)
        
    except RuntimeError as e:
        logger.error(f"Runtime error: {e}")
        print(f"❌ Runtime error: {e}")
        sys.exit(1)
        
    except KeyboardInterrupt:
        logger.info("Process interrupted by user")
        print("\n⚠️ Process interrupted by user")
        sys.exit(1)
        
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        print(f"❌ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
