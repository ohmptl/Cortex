#!/usr/bin/env python3
"""
Test script to verify the Panopto Summarizer setup.
This script checks dependencies and basic functionality without making API calls.
"""

import sys
import importlib
from pathlib import Path


def test_imports():
    """Test if all required modules can be imported."""
    print("🔍 Testing module imports...")
    
    required_modules = [
        'requests',
        'dotenv',
        'google.generativeai',
        'oauthlib.oauth2',
        'requests_oauthlib'
    ]
    
    failed_imports = []
    
    for module in required_modules:
        try:
            importlib.import_module(module)
            print(f"  ✅ {module}")
        except ImportError as e:
            print(f"  ❌ {module}: {e}")
            failed_imports.append(module)
    
    if failed_imports:
        print(f"\n❌ Failed to import: {', '.join(failed_imports)}")
        return False
    
    print("✅ All required modules imported successfully!")
    return True


def test_local_modules():
    """Test if local project modules can be imported."""
    print("\n🔍 Testing local module imports...")
    
    local_modules = ['panopto', 'llm']
    failed_imports = []
    
    for module in local_modules:
        try:
            importlib.import_module(module)
            print(f"  ✅ {module}")
        except ImportError as e:
            print(f"  ❌ {module}: {e}")
            failed_imports.append(module)
    
    if failed_imports:
        print(f"\n❌ Failed to import local modules: {', '.join(failed_imports)}")
        return False
    
    print("✅ All local modules imported successfully!")
    return True


def test_env_file():
    """Check if .env file exists and has required variables."""
    print("\n🔍 Checking environment configuration...")
    
    env_file = Path('.env')
    if not env_file.exists():
        print("  ⚠️  .env file not found")
        print("  💡 Copy env.example to .env and configure your credentials")
        return False
    
    print("  ✅ .env file found")
    
    # Read .env file to check for required variables
    try:
        with open(env_file, 'r') as f:
            content = f.read()
        
        required_vars = [
            'PANOPTO_CLIENT_ID',
            'PANOPTO_CLIENT_SECRET',
            'PANOPTO_BASE_URL',
            'GEMINI_API_KEY'
        ]
        
        missing_vars = []
        for var in required_vars:
            if var not in content or f"{var}=" not in content:
                missing_vars.append(var)
        
        if missing_vars:
            print(f"  ❌ Missing required variables: {', '.join(missing_vars)}")
            return False
        
        print("  ✅ All required environment variables found")
        return True
        
    except Exception as e:
        print(f"  ❌ Error reading .env file: {e}")
        return False


def test_project_structure():
    """Check if all required project files exist."""
    print("\n🔍 Checking project structure...")
    
    required_files = [
        'main.py',
        'panopto.py',
        'llm.py',
        'requirements.txt',
        'env.example',
        'README.md'
    ]
    
    missing_files = []
    
    for file in required_files:
        if Path(file).exists():
            print(f"  ✅ {file}")
        else:
            print(f"  ❌ {file}")
            missing_files.append(file)
    
    if missing_files:
        print(f"\n❌ Missing files: {', '.join(missing_files)}")
        return False
    
    print("✅ All required project files found!")
    return True


def main():
    """Run all tests."""
    print("🚀 Panopto Summarizer - Setup Test")
    print("=" * 50)
    
    tests = [
        test_imports,
        test_local_modules,
        test_env_file,
        test_project_structure
    ]
    
    results = []
    for test in tests:
        try:
            result = test()
            results.append(result)
        except Exception as e:
            print(f"  ❌ Test failed with error: {e}")
            results.append(False)
    
    print("\n" + "=" * 50)
    print("📊 Test Results Summary")
    print("=" * 50)
    
    passed = sum(results)
    total = len(results)
    
    if passed == total:
        print("🎉 All tests passed! Your setup is ready.")
        print("\n📝 Next steps:")
        print("1. Configure your .env file with real credentials")
        print("2. Test with: python main.py SESSION_ID")
    else:
        print(f"⚠️  {passed}/{total} tests passed")
        print("\n🔧 Please fix the issues above before proceeding")
    
    return passed == total


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
