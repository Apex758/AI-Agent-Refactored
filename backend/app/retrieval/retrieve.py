"""
Retrieval module for RAG.
"""
from typing import List, Dict, Any, Optional

from app.retrieval.embeddings import EmbeddingGenerator
from app.retrieval.store import VectorStore
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class Retriever:
    """
    Handles retrieval of relevant context for queries.
    """
    
    def __init__(self):
        self.embedding_generator = EmbeddingGenerator()
        self.vector_store = VectorStore()
        self.top_k = settings.retrieval_top_k
        self.similarity_threshold = settings.retrieval_similarity_threshold
    
    async def retrieve(
        self, 
        query: str, 
        top_k: Optional[int] = None,
        filter_metadata: Optional[Dict] = None
    ) -> List[Dict[str, Any]]:
        """
        Retrieve relevant documents for a query.
        """
        k = top_k or self.top_k
        
        # Generate query embedding
        query_embedding = await self.embedding_generator.generate(query)
        
        # Search vector store
        results = await self.vector_store.search(
            query_embedding=query_embedding,
            top_k=k,
            filter_metadata=filter_metadata
        )
        
        # Filter by similarity threshold
        filtered_results = [
            r for r in results 
            if r.get("distance", 1) <= self.similarity_threshold
        ]
        
        # Format results
        formatted = []
        for r in filtered_results:
            formatted.append({
                "content": r.get("text", ""),
                "source": r.get("metadata", {}).get("source", "unknown"),
                "score": 1 - r.get("distance", 0),  # Convert distance to similarity
                "metadata": r.get("metadata", {})
            })
        
        logger.debug(f"Retrieved {len(formatted)} documents for query: {query[:50]}...")
        return formatted
    
    async def retrieve_with_expansion(
        self,
        query: str,
        top_k: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Retrieve with query expansion (multiple related queries).
        """
        # Original query
        results = await self.retrieve(query, top_k)
        
        # Expand query with synonyms (simple implementation)
        expansion_terms = ["information", "details", "about"]
        
        for term in expansion_terms:
            expanded_query = f"{query} {term}"
            expanded_results = await self.retrieve(expanded_query, top_k=2)
            
            # Merge results, avoiding duplicates
            existing_ids = {r["content"][:50] for r in results}
            for r in expanded_results:
                if r["content"][:50] not in existing_ids:
                    results.append(r)
                    existing_ids.add(r["content"][:50])
        
        return results[:top_k or self.top_k]
    
    async def get_relevant_context(self, query: str) -> str:
        """
        Get formatted context string from retrieved documents.
        """
        results = await self.retrieve(query)
        
        if not results:
            return ""
        
        context_parts = []
        for i, result in enumerate(results, 1):
            context_parts.append(
                f"[{i}] {result['content']}\n"
                f"    Source: {result['source']}"
            )
        
        return "\n\n".join(context_parts)