# Panopto Lecture Summarizer

A Python application that fetches lecture captions from Panopto using their REST API and generates comprehensive summaries using Google's Gemini AI models.

## Features

- 🔐 **OAuth2 Authentication**: Secure authentication with Panopto using Client Credentials flow
- 📝 **Caption Extraction**: Fetches lecture transcripts from Panopto sessions
- 🤖 **AI Summarization**: Uses Google Gemini to generate intelligent lecture summaries
- 📁 **File Output**: Saves summaries to text files for easy access
- 📊 **Comprehensive Logging**: Detailed logging for debugging and monitoring
- ⚙️ **Configurable**: Easy configuration through environment variables

## Project Structure

```
panopto_summarizer/
├── main.py              # Main orchestration script
├── panopto.py           # Panopto API client
├── llm.py              # Google Gemini API client
├── config.py            # Configuration utilities
├── test_setup.py        # Setup verification script
├── example.py           # Usage examples and testing
├── requirements.txt     # Python dependencies
├── env.example         # Environment variables template
├── setup.bat            # Windows setup script
├── setup.sh             # Unix/Linux/macOS setup script
├── README.md            # This file
└── summary.txt          # Generated summary output
```

## Prerequisites

- Python 3.8 or higher
- Panopto OAuth2 Client ID and Secret
- Google AI API Key (for Gemini)
- Access to Panopto REST API

## Installation

### Quick Setup (Recommended)

**Windows:**
```cmd
setup.bat
```

**Unix/Linux/macOS:**
```bash
chmod +x setup.sh
./setup.sh
```

### Manual Setup

1. **Clone or download the project files**

2. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up environment variables:**
   ```bash
   # Option 1: Use the setup command
   python main.py --setup
   
   # Option 2: Manual setup
   cp env.example .env
   
   # Edit .env with your actual credentials
   nano .env  # or use your preferred editor
   ```

4. **Configure your .env file:**
   ```env
   PANOPTO_CLIENT_ID=your_actual_client_id
   PANOPTO_CLIENT_SECRET=your_actual_client_secret
   PANOPTO_BASE_URL=https://your-institution.hosted.panopto.com
   GEMINI_API_KEY=your_actual_gemini_api_key
   ```

5. **Verify your setup:**
   ```bash
   # Check configuration status
   python main.py --config-status
   
   # Run setup tests
   python test_setup.py
   ```

## Usage

### Basic Usage

```bash
python main.py SESSION_ID
```

### Advanced Usage

```bash
# Specify custom output file
python main.py SESSION_ID --output my_summary.txt

# Set logging level
python main.py SESSION_ID --log-level DEBUG

# Get help
python main.py --help
```

### Setup and Configuration

```bash
# Set up environment configuration
python main.py --setup

# Check configuration status
python main.py --config-status

# Test project setup
python test_setup.py

# Run examples with mock data
python example.py
```

### Example

```bash
python main.py 12345-67890-abcdef
```

This will:
1. Authenticate with Panopto using your OAuth2 credentials
2. Fetch captions for session `12345-67890-abcdef`
3. Generate a summary using Google Gemini
4. Save the summary to `summary.txt`

## Configuration

### Panopto Setup

1. **Get OAuth2 Credentials:**
   - Contact your Panopto administrator
   - Request OAuth2 Client ID and Secret
   - Ensure your application has access to the REST API

2. **Base URL:**
   - Use your institution's Panopto hosted URL
   - Example: `https://ncsu.hosted.panopto.com`

### Google Gemini Setup

1. **Get API Key:**
   - Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create a new API key
   - Copy the key to your `.env` file

## API Endpoints

The application uses the following Panopto API endpoints:

- **Authentication**: `POST /Panopto/oauth2/connect/token`
- **Session Info**: `GET /Panopto/api/v1/sessions/{sessionId}`
- **Captions**: `GET /Panopto/api/v1/sessions/{sessionId}/captions`

## Error Handling

The application includes comprehensive error handling for:

- Missing environment variables
- Authentication failures
- API request errors
- Network connectivity issues
- Invalid session IDs
- Empty caption data

## Logging

Logs are written to both:
- **Console**: Real-time output during execution
- **File**: `panopto_summarizer.log` for persistent logging

Log levels: `DEBUG`, `INFO`, `WARNING`, `ERROR`

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Verify your OAuth2 credentials
   - Check that your Panopto base URL is correct
   - Ensure your application has API access

2. **No Captions Found**
   - Verify the session ID is correct
   - Check that the session has captions enabled
   - Ensure your credentials have access to the session

3. **Gemini API Errors**
   - Verify your Google AI API key
   - Check your internet connection
   - Ensure you have sufficient API quota

### Debug Mode

Run with debug logging for detailed information:

```bash
python main.py SESSION_ID --log-level DEBUG
```

## Security Notes

- Never commit your `.env` file to version control
- Keep your OAuth2 credentials and API keys secure
- Use environment variables in production deployments
- Regularly rotate your API keys

## Dependencies

- **requests**: HTTP library for API calls
- **python-dotenv**: Environment variable management
- **google-generativeai**: Google Gemini AI SDK
- **oauthlib**: OAuth2 implementation
- **requests-oauthlib**: OAuth2 session management

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is open source and available under the MIT License.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review the logs for error details
3. Verify your configuration
4. Open an issue with detailed information

## Changelog

### Version 1.0.0
- Initial release
- Panopto OAuth2 authentication
- Caption extraction
- Gemini AI summarization
- File output functionality
- Comprehensive logging
