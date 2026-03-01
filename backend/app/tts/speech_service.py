"""Piper TTS Service for text-to-speech."""
import io
import logging
import os
import tempfile
from typing import Optional

logger = logging.getLogger(__name__)


class SpeechService:
    """Piper text-to-speech service."""
    
    def __init__(self, model_path: Optional[str] = None):
        """Initialize the Piper TTS service.
        
        Args:
            model_path: Path to Piper model file (.onnx). 
                       If None, uses default en_US-lessac-medium.onnx
        """
        self.model_path = model_path
        self.initialized = False
    
    async def initialize(self):
        """Initialize the Piper TTS model."""
        if self.initialized:
            return
        
        try:
            from piper_tts import PiperTTS
            
            logger.info("Initializing Piper TTS model...")
            
            # Use default model if not specified
            if not self.model_path:
                # Default to a lightweight English model in backend/data/models/piper/
                base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
                self.model_path = os.path.join(base_dir, "data", "models", "piper", "en_GB-cori-high.onnx")
            
            self.tts = PiperTTS(self.model_path)
            self.initialized = True
            logger.info(f"Piper TTS model initialized: {self.model_path}")
        except Exception as e:
            logger.error(f"Failed to initialize Piper TTS: {e}")
            raise
    
    async def synthesize(self, text: str, speed: float = 1.0) -> bytes:
        """Synthesize speech from text.
        
        Args:
            text: Text to synthesize
            speed: Speech speed (1.0 = normal, higher = faster)
        
        Returns:
            Audio data as WAV bytes
        """
        if not self.initialized:
            await self.initialize()
        
        try:
            # Generate audio to a temporary file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
                tmp_path = tmp.name
            
            # Synthesize
            await self.tts.synthesize(text, tmp_path, sample_rate=16000)
            
            # Read the generated audio
            with open(tmp_path, 'rb') as f:
                audio_bytes = f.read()
            
            # Clean up
            os.unlink(tmp_path)
            
            return audio_bytes
            
        except Exception as e:
            logger.error(f"TTS synthesis failed: {e}")
            raise


# Global TTS service instance
speech_service = SpeechService()
