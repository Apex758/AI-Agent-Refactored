"""Piper TTS Service — wraps piper.voice.PiperVoice."""
import io
import logging
import os
import wave
from typing import Optional

logger = logging.getLogger(__name__)


class SpeechService:
    """Text-to-speech using the local Piper ONNX model."""

    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path
        self._voice = None   # lazy-loaded on first synthesize call

    def _get_voice(self):
        if self._voice is not None:
            return self._voice

        try:
            from piper.voice import PiperVoice  # piper-tts package

            if not self.model_path:
                # speech_service.py lives at backend/app/tts/ → 3 levels up = backend/
                base_dir = os.path.dirname(
                    os.path.dirname(os.path.dirname(__file__))
                )
                self.model_path = os.path.join(
                    base_dir, "data", "models", "piper", "en_GB-cori-high.onnx"
                )

            logger.info(f"Loading Piper TTS model: {self.model_path}")
            self._voice = PiperVoice.load(self.model_path)
            logger.info("Piper TTS model loaded successfully")
            return self._voice

        except Exception as e:
            logger.error(f"Failed to initialize Piper TTS: {e}")
            raise

    async def synthesize(self, text: str, speed: float = 1.0) -> bytes:
        """Synthesize *text* and return WAV bytes.

        Args:
            text:  Text to speak.
            speed: Ignored for now (PiperVoice uses SynthesisConfig for speed).

        Returns:
            WAV-encoded audio bytes ready to send to the browser.
        """
        voice = self._get_voice()

        # Collect raw 16-bit PCM chunks from the model
        raw_pcm = b""
        sample_rate = voice.config.sample_rate
        for chunk in voice.synthesize(text):
            raw_pcm += chunk.audio_int16_bytes

        # Wrap PCM in a proper WAV container so the browser can decode it
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)       # mono
            wf.setsampwidth(2)       # 16-bit PCM
            wf.setframerate(sample_rate)
            wf.writeframes(raw_pcm)

        return buf.getvalue()


# Module-level singleton reused across requests
speech_service = SpeechService()
