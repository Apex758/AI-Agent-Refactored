"""
Long-term memory management using vector store.
"""
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime

from app.retrieval.embeddings import EmbeddingGenerator
from app.retrieval.store import VectorStore
from app.core.logging import get_logger

logger = get_logger(__name__)


class LongTermMemory:
    """
    Manages long-term memory using vector storage for semantic search.
    """
    
    def __init__(self):
        self.embedding_generator = EmbeddingGenerator()
        self.vector_store = VectorStore()
        self.collection_name = "long_term_memory"
    
    async def store(
        self, 
        content: str, 
        metadata: Optional[Dict] = None
    ) -> str:
        """
        Store a memory in long-term storage.
        """
        memory_id = str(uuid.uuid4())
        
        # Generate embedding
        embedding = await self.embedding_generator.generate(content)
        
        # Prepare metadata
        mem_metadata = metadata or {}
        mem_metadata["type"] = "long_term_memory"
        mem_metadata["created_at"] = datetime.utcnow().isoformat()
        
        # Store in vector database
        await self.vector_store.add(
            id=memory_id,
            text=content,
            embedding=embedding,
            metadata=mem_metadata
        )
        
        logger.info(f"Stored long-term memory: {memory_id}")
        return memory_id
    
    async def search(
        self, 
        query: str, 
        limit: int = 5,
        filter_metadata: Optional[Dict] = None
    ) -> List[Dict[str, Any]]:
        """
        Search long-term memory for relevant content.
        """
        # Generate query embedding
        query_embedding = await self.embedding_generator.generate(query)
        
        # Search vector store
        results = await self.vector_store.search(
            query_embedding=query_embedding,
            top_k=limit,
            filter_metadata=filter_metadata
        )
        
        # Format results
        formatted = []
        for r in results:
            formatted.append({
                "id": r.get("id"),
                "content": r.get("text", ""),
                "metadata": r.get("metadata", {}),
                "score": 1 - r.get("distance", 0)
            })
        
        return formatted
    
    async def get(self, memory_id: str) -> Optional[Dict]:
        """
        Get a specific memory by ID.
        """
        result = await self.vector_store.get(memory_id)
        
        if result:
            return {
                "id": memory_id,
                "content": result.get("text", ""),
                "metadata": result.get("metadata", {})
            }
        
        return None
    
    async def delete(self, memory_id: str):
        """
        Delete a memory.
        """
        await self.vector_store.delete(memory_id)
        logger.info(f"Deleted long-term memory: {memory_id}")
    
    async def get_all_memories(self, limit: int = 100) -> List[Dict]:
        """
        Get all stored memories.
        """
        # This is a simple implementation - in production you'd want pagination
        results = await self.vector_store.search(
            query_embedding=[0] * 384,  # Dummy embedding
            top_k=limit
        )
        
        return [
            {
                "id": r.get("id"),
                "content": r.get("text", ""),
                "metadata": r.get("metadata", {})
            }
            for r in results
        ]
    
    async def clear(self):
        """
        Clear all long-term memories.
        """
        await self.vector_store.clear()
        logger.info("Cleared long-term memory")


class MemoryIndex:
    """
    Index for organizing memories by tags/categories.
    """
    
    def __init__(self):
        self.vector_store = VectorStore()
    
    async def add_tag(self, memory_id: str, tag: str):
        """Add a tag to a memory."""
        # This would update the metadata of an existing memory
        pass
    
    async def get_by_tag(self, tag: str, limit: int = 10) -> List[Dict]:
        """Get memories by tag."""
        return await self.vector_store.search(
            query_embedding=[0] * 384,
            top_k=limit,
            filter_metadata={"tag": tag}
        )
    
    async def get_all_tags(self) -> List[str]:
        """Get all unique tags."""
        # This would require a more complex implementation
        return []