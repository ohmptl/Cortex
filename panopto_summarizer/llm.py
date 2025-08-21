"""
Google Gemini API client for text summarization.
Uses the google-generativeai SDK to generate lecture summaries.
"""

import os
import logging
from typing import Optional
import google.generativeai as genai

logger = logging.getLogger(__name__)


class GeminiClient:
    """Client for interacting with Google Gemini API."""
    
    def __init__(self, api_key: str):
        """
        Initialize Gemini client.
        
        Args:
            api_key: Google AI API key
        """
        self.api_key = api_key
        genai.configure(api_key=api_key)
        
        # Configure the model
        self.model = genai.GenerativeModel('gemini-2.0-flash')
        
        # Set generation config for better summaries
        self.generation_config = genai.types.GenerationConfig(
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
            response = self.model.generate_content(
                prompt,
                generation_config=self.generation_config
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
                'model_name': self.model.model_name,
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
