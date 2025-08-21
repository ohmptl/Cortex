#!/bin/bash

echo "========================================"
echo "Panopto Lecture Summarizer - Setup"
echo "========================================"
echo

echo "Installing Python dependencies..."
pip install -r requirements.txt

if [ $? -ne 0 ]; then
    echo
    echo "❌ Failed to install dependencies"
    echo "Please check your Python installation"
    exit 1
fi

echo
echo "✅ Dependencies installed successfully!"
echo

echo "Setting up environment configuration..."
python main.py --setup

if [ $? -ne 0 ]; then
    echo
    echo "❌ Failed to set up environment"
    exit 1
fi

echo
echo "Checking configuration status..."
python main.py --config-status

echo
echo "========================================"
echo "Setup Complete!"
echo "========================================"
echo
echo "Next steps:"
echo "1. Edit the .env file with your credentials"
echo "2. Test your setup: python test_setup.py"
echo "3. Run with: python main.py SESSION_ID"
echo
