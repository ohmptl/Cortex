# Deprecated Panopto Lecture Summarizer

> This standalone local-token/Gemini workflow is retained only as migration history and is not part of Cortex runtime. Use the server-side delegated OAuth provider, explicit course-folder mapping, and `npm run sync:panopto` ingestion path. Do not deploy or extend this legacy script.

A Python script that fetches lecture captions from Panopto and generates AI-powered summaries using Google Gemini.

## Features

- 🎥 **Automated Caption Extraction**: Direct download of captions from Panopto sessions
- 🤖 **AI-Powered Summaries**: Uses Google Gemini for intelligent text summarization  
- 🔐 **OAuth2 Authentication**: Secure authentication with automatic token persistence
- 📚 **Batch Processing**: Process multiple sessions in a single run
- 🖥️ **Server Deployment Ready**: Built-in deployment assessment and guidance
- 📝 **Smart File Naming**: Uses session names as filenames (e.g., "ECE 301 08-20-25.txt")
- 📄 **Formatted Summaries**: Includes session metadata and structured headers
- ⚙️ **Easy Setup**: Interactive configuration with validation

## Quick Start

### 1. Environment Setup

```bash
# Clone or download the repository
cd panopto_summarizer

# Install dependencies
pip install -r requirements.txt

# Run interactive setup
python main.py --setup
```

The setup will guide you through configuring:
- Panopto OAuth2 credentials (Client ID, Secret, Base URL)
- Google Gemini API key

### 2. First Run

```bash
# Process a single session
python main.py YOUR_SESSION_ID

# The first run will open a browser for OAuth2 authorization
# Subsequent runs will use saved tokens automatically
```

### 3. Check Your Results

The script will:
1. 📥 Fetch captions from Panopto
2. 🤖 Generate an AI summary using Gemini
3. � Format the summary with session information header
4. �💾 Save to a file named after the session (e.g., "ECE 301 08-20-25.txt")

## Smart File Naming & Formatting

### Automatic Filename Generation
- **Session-based naming**: Files are named using the actual session title
- **Safe characters**: Problematic characters (/, :, *, etc.) are automatically replaced
- **Example**: "ECE 301 08/20/25" becomes "ECE 301 08-20-25.txt"
- **Fallback**: If no session name available, uses session ID

### Formatted Summaries
Each summary includes:
```markdown
# ECE 301 08/20/25

**Session Information:**
- **Session ID:** eefe1dbd-65f9-45da-8d30-b33a01482b51
- **Date:** 08/20/24 at 02:30 PM
- **Duration:** 1h 11m

---

## Summary
[AI-generated summary content here...]
```

## Usage Examples

### Authentication Only (No LLM Usage)
```bash
# Run without session ID to authenticate and check token status
# This will NOT consume any LLM tokens - perfect for testing auth
python main.py

# If no valid tokens exist, it will automatically:
# 1. Open your browser for OAuth2 authorization
# 2. Save tokens for future use  
# 3. Show token status and readiness
```

### Single Session Processing
```bash
# Basic usage
python main.py abc123-def456-ghi789

# Custom output file
python main.py abc123-def456-ghi789 --output lecture1_summary.txt
```

### Batch Processing
```bash
# Process multiple sessions
python main.py "session1,session2,session3" --batch-output ./summaries/

# Results are saved as: SESSION_ID_SESSION_NAME_summary.txt
```

### Token Management
```bash
# Check token status
python main.py --token-status

# Clear tokens (force re-authorization)
python main.py --clear-tokens

# Authentication-only mode (no LLM tokens used)
python main.py

# Get server deployment guidance
python main.py --deployment-guide
```

### Configuration Management
```bash
# Check configuration
python main.py --config-status

# Re-run setup
python main.py --setup
```

## Server Deployment

The script includes built-in assessment for server deployment scenarios:

```bash
python main.py --deployment-guide
```

### Deployment Strategies

1. **🔄 Frequent Execution** (Recommended)
   - Run every 30-60 minutes via cron/scheduled task
   - Tokens auto-refresh when possible
   - Minimal overhead for valid tokens

2. **📅 Batch Processing**
   - Process multiple sessions per run
   - Reduce authentication overhead
   - Example: Daily lecture processing

3. **🔧 Token Monitoring**
   - Check token status before runs
   - Set up expiry alerts
   - Monitor authentication issues

4. **🏠 Local Proxy** (Advanced)
   - Run on machine with browser access
   - Expose API for server calls
   - Handle authentication centrally

### Example Cron Job (Linux/Mac)
```bash
# Process session every hour
0 * * * * cd /path/to/script && python main.py SESSION_ID
```

### Example Scheduled Task (Windows)
1. Open Task Scheduler
2. Create Basic Task → Hourly
3. Action: Start Program
4. Program: `python`
5. Arguments: `main.py SESSION_ID`
6. Start in: `C:\path\to\script`

## Configuration

### Environment Variables
```bash
PANOPTO_CLIENT_ID=your_client_id
PANOPTO_CLIENT_SECRET=your_client_secret
PANOPTO_BASE_URL=https://your-institution.panopto.com
GEMINI_API_KEY=your_gemini_api_key
```

### OAuth2 Setup

1. Log into your Panopto admin panel
2. Go to System → OAuth2 → Create New Client
3. Set redirect URI to: `http://localhost:8080/callback`
4. Note the Client ID and Secret
5. Use in configuration

### Getting Gemini API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Add to your configuration

## Command Line Options

```bash
usage: main.py [-h] [--output OUTPUT] [--log-level {DEBUG,INFO,WARNING,ERROR}] 
               [--clear-tokens] [--token-status] [--deployment-guide] 
               [--batch-output BATCH_OUTPUT] [--setup] [--config-status]
               [session_id]

Arguments:
  session_id              Session ID or comma-separated list for batch processing

Options:
  --output, -o            Output file (default: summary.txt)
  --log-level             Logging level (DEBUG/INFO/WARNING/ERROR)
  --clear-tokens          Clear stored tokens, force re-auth
  --token-status          Show current token status
  --deployment-guide      Show server deployment recommendations
  --batch-output          Directory for batch processing results
  --setup                 Interactive environment setup
  --config-status         Show configuration validation
```

## Troubleshooting

### Common Issues

**❌ "Failed to retrieve captions"**
- Captions may still be processing (wait 2+ hours for new recordings)
- Check if captions are enabled in Panopto settings
- Verify you have permission to access captions
- Try accessing the session in Panopto web interface first

**❌ "Configuration error: Missing required environment variables"**
- Run `python main.py --setup` to configure
- Check `.env` file exists and has all required variables
- Use `python main.py --config-status` to validate

**❌ "Token expired" or authentication errors**
- Run `python main.py --clear-tokens` to force re-authentication
- Check `python main.py --token-status` for token health
- Tokens typically expire after 1-4 hours

**❌ Gemini API errors**
- Verify API key is correct and has quota remaining
- Check Google AI Studio for API key status
- Some text may be too long - try shorter content

### Debug Mode
```bash
python main.py SESSION_ID --log-level DEBUG
```

## File Structure

```
panopto_summarizer/
├── main.py              # Main script with CLI interface
├── panopto.py           # Panopto API client
├── panopto_oauth2.py    # OAuth2 authentication handler  
├── llm.py               # Gemini AI client
├── config.py            # Configuration management
├── requirements.txt     # Python dependencies
├── .env.example         # Environment template
├── .env                 # Your configuration (created by setup)
├── .panopto_tokens.json # Stored OAuth2 tokens (auto-created)
└── summary.txt          # Generated summaries (default output)
```

## Token Persistence

The script automatically saves OAuth2 tokens to `.panopto_tokens.json`:
- ✅ Eliminates repeated browser authentication
- ✅ Works across script runs
- ✅ Handles token validation and expiry
- ⚠️ Limited by Panopto's token lifetime (typically 1-4 hours)

**Note**: Panopto may not provide refresh tokens, requiring periodic re-authorization.

## Security Notes

- 🔒 Store `.env` and `.panopto_tokens.json` securely
- 🚫 Never commit secrets to version control
- 🔄 Tokens expire automatically for security
- 🛡️ Use environment variables in production

## Dependencies

- `requests` - HTTP client for API calls
- `google-generativeai` - Google Gemini AI client  
- `python-dotenv` - Environment variable management
- `python-dateutil` - Date parsing utilities

## License

This project is open source. Please ensure compliance with your institution's Panopto terms of service and API usage policies.
