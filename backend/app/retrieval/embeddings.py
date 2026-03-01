"""
Embedding generation for vector storage.
"""
from typing import List, Optional
import numpy as np

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class EmbeddingGenerator:
    """
    Generates embeddings for text using sentence transformers.
    """
    
    def __init__(self):
        self.model_name = settings.embedding_model
        self.dimensions = settings.embedding_dimensions
        self._model = None
    
    async def _get_model(self):
        """Lazy load the model."""
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self.model_name)
        return self._model
    
    async def generate(self, text: str) -> List[float]:
        """
        Generate an embedding for a single text.
        """
        model = await self._get_model()
        
        # Generate embedding
        embedding = model.encode(text, convert_to_numpy=True)
        
        return embedding.tolist()
    
    async def generate_batch(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts.
        """
        model = await self._get_model()
        
        # Generate embeddings
        embeddings = model.encode(texts, convert_to_numpy=True)
        
        return [emb.tolist() for emb in embeddings]
    
    def get_dimensions(self) -> int:
        """Get the dimensions of the embeddings."""
        return self.dimensions


class OpenAIEmbeddingGenerator:
    """
    Alternative embedding generator using OpenAI API.
    """
    
    def __init__(self, model: str = "text-embedding-ada-002"):
        self.model = model
        self.dimensions = 1536
    
    async def generate(self, text: str) -> List[float]:
        """
        Generate an embedding using OpenAI API.
        """
        from langchain_openai import OpenAIEmbeddings
        
        embeddings = OpenAIEmbeddings(model=self.model)
        embedding = await embeddings.aembed_query(text)
        
        return embedding
    
    async def generate_batch(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts using OpenAI API.
        """
        from langchain_openai import OpenAIEmbeddings
        
        embeddings = OpenAIEmbeddings(model=self.model)
        result = await embeddings.aembed_documents(texts)
        
        return result
    
    def get_dimensions(self) -> int:
        """Get the dimensions of the embeddings."""
        return self.dimensions


def get_embedding_generator() -> EmbeddingGenerator:
    """
    Factory function to get the appropriate embedding generator.
    """
    # Use sentence transformers by default
    return EmbeddingGenerator()