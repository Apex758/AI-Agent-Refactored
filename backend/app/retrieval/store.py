"""
Vector store for embeddings using ChromaDB.
"""
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime

import chromadb
from chromadb.config import Settings as ChromaSettings

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class VectorStore:
    """
    Vector store using ChromaDB for embeddings.
    """
    
    def __init__(self):
        self.persist_directory = settings.chroma_persist_directory
        self.collection_name = "documents"
        self._client = None
        self._collection = None
    
    def _get_client(self):
        """Get or create ChromaDB client."""
        if self._client is None:
            self._client = chromadb.PersistentClient(
                path=self.persist_directory,
                settings=ChromaSettings(
                    anonymized_telemetry=False,
                    allow_reset=True
                )
            )
        return self._client
    
    def _get_collection(self):
        """Get or create the collection."""
        if self._collection is None:
            client = self._get_client()
            self._collection = client.get_or_create_collection(
                name=self.collection_name,
                metadata={"description": "Document embeddings for RAG"}
            )
        return self._collection
    
    async def add(
        self,
        id: str,
        text: str,
        embedding: List[float],
        metadata: Optional[Dict] = None
    ):
        """
        Add a document with its embedding to the store.
        """
        collection = self._get_collection()
        
        doc_metadata = metadata or {}
        doc_metadata["created_at"] = datetime.utcnow().isoformat()
        
        collection.add(
            ids=[id],
            documents=[text],
            embeddings=[embedding],
            metadatas=[doc_metadata]
        )
        
        logger.debug(f"Added document to vector store: {id}")
    
    async def get(self, id: str) -> Optional[Dict]:
        """
        Get a document by ID.
        """
        collection = self._get_collection()
        
        result = collection.get(ids=[id])
        
        if result and result["documents"]:
            return {
                "id": id,
                "text": result["documents"][0],
                "metadata": result["metadatas"][0] if result["metadatas"] else {}
            }
        
        return None
    
    async def delete(self, id: str):
        """
        Delete a document by ID.
        """
        collection = self._get_collection()
        collection.delete(ids=[id])
        logger.debug(f"Deleted document from vector store: {id}")
    
    async def search(
        self,
        query_embedding: List[float],
        top_k: int = 5,
        filter_metadata: Optional[Dict] = None
    ) -> List[Dict]:
        """
        Search for similar documents.
        """
        collection = self._get_collection()
        
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            where=filter_metadata
        )
        
        documents = []
        if results and results["documents"]:
            for i, doc in enumerate(results["documents"][0]):
                documents.append({
                    "id": results["ids"][0][i],
                    "text": doc,
                    "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                    "distance": results["distances"][0][i] if results.get("distances") else 0
                })
        
        return documents
    
    async def delete_document(self, document_id: str):
        """
        Delete a document and all its chunks.
        """
        collection = self._get_collection()
        
        # Delete by parent_id or exact id
        collection.delete(
            where={"parent_id": document_id}
        )
        collection.delete(ids=[document_id])
        
        logger.info(f"Deleted document: {document_id}")
    
    async def get_document_status(self, document_id: str) -> Optional[Dict]:
        """
        Get the status of an ingested document.
        """
        collection = self._get_collection()
        
        # Get chunks
        results = collection.get(
            where={"parent_id": document_id}
        )
        
        if not results or not results["documents"]:
            # Try exact ID
            results = collection.get(ids=[document_id])
            
            if not results or not results["documents"]:
                return None
        
        return {
            "document_id": document_id,
            "chunks": len(results["documents"]),
            "status": "indexed"
        }
    
    async def list_documents(self) -> List[Dict]:
        """
        List all documents in the store.
        """
        collection = self._get_collection()
        
        # Get all unique parent IDs
        results = collection.get()
        
        if not results or not results["documents"]:
            return []
        
        # Group by parent_id
        documents = {}
        for i, doc in enumerate(results["documents"]):
            parent_id = results["metadatas"][i].get("parent_id", results["ids"][i])
            if parent_id not in documents:
                documents[parent_id] = {
                    "id": parent_id,
                    "type": results["metadatas"][i].get("type", "unknown"),
                    "source": results["metadatas"][i].get("source", "unknown"),
                    "chunks": 0
                }
            documents[parent_id]["chunks"] += 1
        
        return list(documents.values())
    
    async def clear(self):
        """
        Clear all documents from the store.
        """
        client = self._get_client()
        client.delete_collection(name=self.collection_name)
        self._collection = None
        logger.info("Cleared vector store")