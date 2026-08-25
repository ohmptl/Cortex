"""
Google Gemini API client for text summarization.
Uses the google-genai SDK (unified Gen AI SDK) to generate lecture summaries.
"""

import logging
from typing import Optional
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

MODEL_NAME = "gemini-3.7-flash"


class GeminiClient:
    """Client for interacting with Google Gemini API."""
    
    def __init__(self, api_key: str):
        """
        Initialize Gemini client.
        
        Args:
            api_key: Google AI API key
        """
        self.api_key = api_key
        self.client = genai.Client(api_key=api_key)
        self.model_name = MODEL_NAME

        # Generation config for better summaries
        self.generation_config = types.GenerateContentConfig(
            temperature=0.3,
            top_p=0.8,
            top_k=40,
            max_output_tokens=2048,
        )
        
        logger.info("Gemini client initialized successfully")
    
    def summarize_text(self, text: str) -> Optional[str]:
        """
        Generate a summary of the provided text using Gemini.
        
        Args:
            text: Text to summarize
            
        Returns:
            Generated summary as string, or None if failed
        """
        if not text or not text.strip():
            logger.warning("Empty text provided for summarization")
            return None
        
        try:
            # Create a prompt for summarization
            prompt = f"""
            Please provide a comprehensive summary of the following lecture transcript. 
            Focus on the main topics, key concepts, and important points discussed.
            Make the summary clear, well-structured, and easy to understand.
            
            Lecture Transcript:
            {text}
            
            Summary:
            """
            
            # Generate response
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=self.generation_config,
            )
            
            if response.text:
                logger.info("Successfully generated summary using Gemini")
                return response.text.strip()
            else:
                logger.error("Gemini returned empty response")
                return None
                
        except Exception as e:
            logger.error(f"Failed to generate summary: {e}")
            return None
    
    def get_model_info(self) -> dict:
        """
        Get information about the current model configuration.
        
        Returns:
            Dictionary with model information
        """
        try:
            return {
                'model_name': self.model_name,
                'generation_config': {
                    'temperature': self.generation_config.temperature,
                    'top_p': self.generation_config.top_p,
                    'top_k': self.generation_config.top_k,
                    'max_output_tokens': self.generation_config.max_output_tokens
                }
            }
        except Exception as e:
            logger.error(f"Failed to get model info: {e}")
            return {}
