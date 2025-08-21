@echo off
echo ========================================
echo Panopto Lecture Summarizer - Setup
echo ========================================
echo.

echo Installing Python dependencies...
pip install -r requirements.txt

if %errorlevel% neq 0 (
    echo.
    echo ❌ Failed to install dependencies
    echo Please check your Python installation
    pause
    exit /b 1
)

echo.
echo ✅ Dependencies installed successfully!
echo.

echo Setting up environment configuration...
python main.py --setup

if %errorlevel% neq 0 (
    echo.
    echo ❌ Failed to set up environment
    pause
    exit /b 1
)

echo.
echo Checking configuration status...
python main.py --config-status

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo Next steps:
echo 1. Edit the .env file with your credentials
echo 2. Test your setup: python test_setup.py
echo 3. Run with: python main.py SESSION_ID
echo.
pause
