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
        duration = session_info.get('Duration', 0)
        logger.info(f"Duration: {duration} seconds")
        
        # Check if session is too recent (might still be processing)
        import datetime
        start_time = session_info.get('StartTime')
        if start_time:
            try:
                # Parse the start time and check how recent it is
                from dateutil import parser
                session_start = parser.parse(start_time)
                now = datetime.datetime.now(session_start.tzinfo)
                hours_since_recording = (now - session_start).total_seconds() / 3600
                
                if hours_since_recording < 2:
                    logger.warning(f"Session recorded only {hours_since_recording:.1f} hours ago - captions may still be processing")
                    print(f"⚠️  Note: This session was recorded {hours_since_recording:.1f} hours ago.")
                    print("   Captions may still be processing. Try again in a few hours.")
            except Exception as e:
                logger.debug(f"Could not parse start time: {e}")
    
    # Get captions
    captions = panopto_client.get_captions(session_id)
    
    if not captions:
        # Provide helpful error message with troubleshooting steps
        error_msg = f"Failed to retrieve captions for session {session_id}"
        logger.error(error_msg)
        
        print("\n❌ Could not retrieve captions for this session.")
        print("\nPossible reasons:")
        print("1. 🕒 Captions are still being processed (for recent recordings)")
        print("2. 🚫 Captions are disabled for this session")
        print("3. 🔒 You may not have permission to access captions")
        print("4. 📝 This session might not have any spoken content")
        print("5. 🛠️  The session might be corrupted or have technical issues")
        
        print("\nTroubleshooting steps:")
        print("1. Wait a few hours and try again (especially for recent recordings)")
        print("2. Check if captions are visible when viewing the session in Panopto web interface")
        print("3. Contact your Panopto administrator to verify caption settings")
        print("4. Try a different session ID to test if the issue is session-specific")
        
        # Check if we can suggest using the description field instead
        if session_info and session_info.get('Description'):
            description = session_info['Description'].strip()
            if len(description) > 50:
                print(f"\n💡 Alternative: This session has a description ({len(description)} characters).")
                print("   You could try summarizing the description instead of captions.")
                
                # Ask user if they want to use the description
                try:
                    use_description = input("\nWould you like to summarize the session description instead? (y/N): ").strip().lower()
                    if use_description in ['y', 'yes']:
                        logger.info("User chose to use session description instead of captions")
                        return description
                except (KeyboardInterrupt, EOFError):
                    pass
        
        raise RuntimeError(error_msg)
    
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


def process_batch_sessions(session_ids: list, panopto_client: PanoptoClient, 
                         gemini_client: GeminiClient, output_dir: str = ".") -> dict:
    """
    Process multiple sessions in batch mode.
    
    Args:
        session_ids: List of session IDs to process
        panopto_client: Initialized Panopto client
        gemini_client: Initialized Gemini client
        output_dir: Directory to save results
        
    Returns:
        Dictionary with processing results for each session
    """
    logger = logging.getLogger(__name__)
    results = {}
    
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)
    
    print(f"\n🔄 Batch processing {len(session_ids)} sessions...")
    print(f"📁 Output directory: {output_path.absolute()}")
    
    for i, session_id in enumerate(session_ids, 1):
        print(f"\n--- Processing {i}/{len(session_ids)}: {session_id} ---")
        
        try:
            # Get session info for better file naming
            session_info = panopto_client.get_session_info(session_id)
            session_name = session_info.get('Name', session_id) if session_info else session_id
            
            # Create safe filename
            safe_name = "".join(c for c in session_name if c.isalnum() or c in (' ', '-', '_')).rstrip()
            safe_name = safe_name[:50] if len(safe_name) > 50 else safe_name  # Limit filename length
            
            output_file = output_path / f"{session_id}_{safe_name}_summary.txt"
            
            # Process session
            print(f"📥 Fetching captions...")
            captions = get_captions(session_id, panopto_client)
            
            print(f"🤖 Generating summary...")
            summary = summarize_text(captions, gemini_client)
            
            print(f"💾 Saving to {output_file.name}...")
            save_summary(summary, str(output_file))
            
            results[session_id] = {
                'status': 'success',
                'session_name': session_name,
                'caption_length': len(captions),
                'summary_length': len(summary),
                'output_file': str(output_file)
            }
            
            print(f"✅ Completed successfully ({len(captions)} chars → {len(summary)} chars)")
            
        except Exception as e:
            logger.error(f"Failed to process session {session_id}: {e}")
            results[session_id] = {
                'status': 'failed',
                'error': str(e)
            }
            print(f"❌ Failed: {e}")
            
            # Ask user if they want to continue with remaining sessions
            if i < len(session_ids):
                try:
                    continue_choice = input(f"Continue with remaining {len(session_ids) - i} sessions? (Y/n): ").strip().lower()
                    if continue_choice in ['n', 'no']:
                        print("Stopping batch processing...")
                        break
                except (KeyboardInterrupt, EOFError):
                    print("\nStopping batch processing...")
                    break
    
    return results


def print_batch_results(results: dict) -> None:
    """Print batch processing results summary."""
    print("\n" + "="*60)
    print("📊 BATCH PROCESSING RESULTS")
    print("="*60)
    
    successful = sum(1 for r in results.values() if r['status'] == 'success')
    failed = sum(1 for r in results.values() if r['status'] == 'failed')
    
    print(f"Total Sessions: {len(results)}")
    print(f"✅ Successful: {successful}")
    print(f"❌ Failed: {failed}")
    
    if successful > 0:
        print(f"\n🎉 Successfully processed sessions:")
        for session_id, result in results.items():
            if result['status'] == 'success':
                print(f"  • {session_id}: {result['session_name']}")
                print(f"    📁 {Path(result['output_file']).name}")
                print(f"    📊 {result['caption_length']} → {result['summary_length']} chars")
    
    if failed > 0:
        print(f"\n⚠️  Failed sessions:")
        for session_id, result in results.items():
            if result['status'] == 'failed':
                print(f"  • {session_id}: {result['error']}")


def main():
    """Main function."""
    parser = argparse.ArgumentParser(
        description="Panopto Lecture Summarizer - Fetch captions and generate summaries"
    )
    parser.add_argument(
        "session_id",
        nargs="?",
        help="Panopto session ID to process (or comma-separated list for batch processing). If omitted, performs authentication check only."
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
        "--clear-tokens",
        action="store_true",
        help="Clear stored OAuth2 tokens and force re-authorization"
    )
    parser.add_argument(
        "--token-status",
        action="store_true",
        help="Show current token status and exit"
    )
    parser.add_argument(
        "--deployment-guide",
        action="store_true",
        help="Show server deployment guide and recommendations"
    )
    parser.add_argument(
        "--batch-output",
        help="Directory to save batch processing results (default: current directory)"
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
    parser.add_argument(
        "--unattended",
        action="store_true", 
        help="Attempt unattended authentication (Client Credentials flow). Requires server-to-server OAuth2 client configuration."
    )
    
    args = parser.parse_args()
    
    # Setup logging first
    setup_logging(args.log_level)
    logger = logging.getLogger(__name__)
    
    # Handle setup and config commands first
    if args.setup:
        from config import setup_env_file
        setup_env_file()
        return
    
    if args.config_status:
        config = Config()
        config.print_config_status()
        return
    
    # Handle token management commands
    if args.clear_tokens or args.token_status or args.deployment_guide:
        try:
            # Load configuration
            config = load_environment()
            
            # Initialize Panopto client to access token management
            panopto_client = PanoptoClient(
                client_id=config.panopto_client_id,
                client_secret=config.panopto_client_secret,
                base_url=config.panopto_base_url,
                unattended=args.unattended
            )
            
            if args.clear_tokens:
                panopto_client.oauth2.clear_stored_tokens()
                print("✅ Stored tokens cleared successfully")
                print("   Next authentication will require browser authorization")
                return
                
            if args.token_status:
                status = panopto_client.oauth2.get_token_status()
                print("🔑 Token Status")
                print("=" * 40)
                print(f"Access Token: {'✅ Present' if status['has_access_token'] else '❌ Not available'}")
                print(f"Refresh Token: {'✅ Present' if status['has_refresh_token'] else '❌ Not available'}")
                print(f"Token Valid: {'✅ Yes' if status['is_token_valid'] else '❌ No'}")
                print(f"Token File: {'✅ Exists' if status['token_file_exists'] else '❌ Missing'}")
                
                if status['seconds_until_expiry'] is not None:
                    if status['seconds_until_expiry'] > 0:
                        hours = status['seconds_until_expiry'] / 3600
                        print(f"Expires in: {hours:.1f} hours")
                    else:
                        print("Token: ⚠️ Expired")
                else:
                    print("Expiry: Unknown")
                
                # Show deployment suitability
                is_suitable, reason = panopto_client.oauth2.is_suitable_for_server_deployment()
                print(f"\nServer Deployment: {'✅ Suitable' if is_suitable else '⚠️ Not optimal'}")
                print(f"  {reason}")
                return
            
            if args.deployment_guide:
                guide = panopto_client.oauth2.generate_server_deployment_guide()
                print(guide)
                return
                
        except Exception as e:
            print(f"❌ Error managing tokens: {e}")
            sys.exit(1)
    
    # Handle authentication-only mode when no session_id provided
    if not args.session_id:
        print("🔑 Authentication Mode")
        print("=" * 40)
        print("No session ID provided - performing authentication check and token refresh")
        
        try:
            # Load configuration
            config = load_environment()
            print("✅ Configuration loaded successfully")
            
            # Initialize only Panopto client (no need for Gemini without processing)
            panopto_client = PanoptoClient(
                client_id=config.panopto_client_id,
                client_secret=config.panopto_client_secret,
                base_url=config.panopto_base_url,
                unattended=args.unattended
            )
            print("✅ Panopto client initialized")
            
            # Trigger authentication by checking token status
            # This will prompt for OAuth2 if needed
            status = panopto_client.oauth2.get_token_status()
            
            # If no valid token, try to get one
            if not status['is_token_valid'] and not status['has_access_token']:
                auth_mode = "unattended" if args.unattended else "interactive"
                print(f"🔄 No valid tokens found - initiating {auth_mode} authentication...")
                try:
                    # Use the new auto authentication method
                    token = panopto_client.oauth2.get_access_token_auto(prefer_unattended=args.unattended)
                    if token:
                        print("✅ Authentication successful!")
                        # Re-check status after authentication
                        status = panopto_client.oauth2.get_token_status()
                    else:
                        print("❌ Authentication failed")
                except Exception as auth_error:
                    print(f"❌ Authentication error: {auth_error}")
                    if args.unattended:
                        print("💡 Client Credentials authentication failed.")
                        print("   This might mean your Panopto server doesn't support Client Credentials,")
                        print("   or your client doesn't have the necessary permissions.")
                        print("   Try running without --unattended flag for interactive authentication.")
                    else:
                        print("💡 You may need to complete the OAuth2 flow in your browser")
            
            print("\n🔑 Token Status After Authentication:")
            print("=" * 45)
            print(f"Access Token: {'✅ Present' if status['has_access_token'] else '❌ Not available'}")
            print(f"Refresh Token: {'✅ Present' if status['has_refresh_token'] else '❌ Not available'}")
            print(f"Token Valid: {'✅ Yes' if status['is_token_valid'] else '❌ No'}")
            print(f"Token File: {'✅ Exists' if status['token_file_exists'] else '❌ Missing'}")
            
            if status['seconds_until_expiry'] is not None:
                if status['seconds_until_expiry'] > 0:
                    hours = status['seconds_until_expiry'] / 3600
                    print(f"Expires in: {hours:.1f} hours")
                else:
                    print("Token: ⚠️ Expired")
            
            # Show deployment suitability
            is_suitable, reason = panopto_client.oauth2.is_suitable_for_server_deployment()
            print(f"\nServer Deployment: {'✅ Suitable' if is_suitable else '⚠️ Not optimal'}")
            print(f"  {reason}")
            
            print(f"\n💡 Ready for processing! Use:")
            print(f"   python main.py SESSION_ID")
            print(f"   python main.py \"session1,session2,session3\" --batch-output ./results/")
            
            return
            
        except Exception as e:
            print(f"❌ Authentication failed: {e}")
            print("💡 Try: python main.py --setup to configure credentials")
            sys.exit(1)
    
    try:
        logger.info("Starting Panopto Lecture Summarizer")
        
        # Load configuration
        config = load_environment()
        logger.info("Environment variables loaded successfully")
        
        # Initialize clients
        gemini_client = GeminiClient(api_key=config.gemini_api_key)
        logger.info("Gemini client initialized successfully")
        
        panopto_client = PanoptoClient(
            client_id=config.panopto_client_id,
            client_secret=config.panopto_client_secret,
            base_url=config.panopto_base_url,
            unattended=args.unattended
        )
        
        logger.info("Clients initialized successfully")
        
        # Check if we're doing batch processing
        session_ids = [s.strip() for s in args.session_id.split(',') if s.strip()]
        
        if len(session_ids) > 1:
            # Batch processing mode
            logger.info(f"Starting batch processing for {len(session_ids)} sessions")
            
            output_dir = args.batch_output or "."
            results = process_batch_sessions(session_ids, panopto_client, gemini_client, output_dir)
            print_batch_results(results)
            
            # Check if any failed
            failed_count = sum(1 for r in results.values() if r['status'] == 'failed')
            if failed_count > 0:
                logger.warning(f"Batch processing completed with {failed_count} failures")
                sys.exit(1)
            else:
                logger.info("Batch processing completed successfully!")
        else:
            # Single session processing
            session_id = session_ids[0]
            
            # Fetch captions
            captions = get_captions(session_id, panopto_client)
            
            # Generate summary
            summary = summarize_text(captions, gemini_client)
            
            # Save summary
            save_summary(summary, args.output)
            
            logger.info("Process completed successfully!")
            print(f"\n✅ Summary generated and saved to: {args.output}")
            print(f"📝 Session ID: {session_id}")
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
