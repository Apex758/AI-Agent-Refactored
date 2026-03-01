"""
Document ingestion for retrieval-augmented generation.
"""
import os
from typing import Dict, Any, Optional
import uuid
from pathlib import Path

from app.retrieval.embeddings import EmbeddingGenerator
from app.retrieval.store import VectorStore
from app.core.logging import get_logger

logger = get_logger(__name__)


class DocumentIngestor:
    """
    Handles document ingestion and embedding creation.
    """
    
    def __init__(self):
        self.embedding_generator = EmbeddingGenerator()
        self.vector_store = VectorStore()
    
    async def ingest_text(
        self, 
        text: str, 
        source: str = "manual",
        metadata: Optional[Dict] = None
    ) -> str:
        """
        Ingest text content and create embeddings.
        """
        document_id = str(uuid.uuid4())
        
        # Create metadata
        doc_metadata = metadata or {}
        doc_metadata["source"] = source
        doc_metadata["type"] = "text"
        
        # Generate embedding
        embedding = await self.embedding_generator.generate(text)
        
        # Store in vector database
        await self.vector_store.add(
            id=document_id,
            text=text,
            embedding=embedding,
            metadata=doc_metadata
        )
        
        logger.info(f"Ingested text document: {document_id}")
        return document_id
    
    async def ingest_file(
        self, 
        file_path: str, 
        metadata: Optional[Dict] = None
    ) -> str:
        """
        Ingest a file and create embeddings.
        """
        document_id = str(uuid.uuid4())
        
        # Determine file type and extract content
        ext = os.path.splitext(file_path)[1].lower()
        
        if ext == ".txt":
            content = await self._read_text_file(file_path)
        elif ext == ".md":
            content = await self._read_text_file(file_path)
        elif ext == ".pdf":
            content = await self._read_pdf_file(file_path)
        else:
            # Default to text
            content = await self._read_text_file(file_path)
        
        # Create metadata
        doc_metadata = metadata or {}
        doc_metadata["source"] = "file"
        doc_metadata["file_path"] = file_path
        doc_metadata["type"] = ext
        
        # Split into chunks if too long
        chunks = self._split_into_chunks(content)
        
        # Generate embeddings for each chunk
        for i, chunk in enumerate(chunks):
            chunk_id = f"{document_id}_{i}"
            embedding = await self.embedding_generator.generate(chunk)
            
            chunk_metadata = {
                **doc_metadata,
                "chunk_index": i,
                "total_chunks": len(chunks),
                "parent_id": document_id
            }
            
            await self.vector_store.add(
                id=chunk_id,
                text=chunk,
                embedding=embedding,
                metadata=chunk_metadata
            )
        
        logger.info(f"Ingested file: {document_id} with {len(chunks)} chunks")
        return document_id
    
    async def ingest_url(
        self, 
        url: str, 
        metadata: Optional[Dict] = None
    ) -> str:
        """
        Ingest content from a URL.
        """
        import httpx
        from bs4 import BeautifulSoup
        
        document_id = str(uuid.uuid4())
        
        # Fetch the URL
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=15.0)
            
            if response.status_code != 200:
                raise ValueError(f"Failed to fetch URL: {response.status_code}")
            
            # Parse HTML
            soup = BeautifulSoup(response.text, "lxml")
            
            # Remove script and style elements
            for script in soup(["script", "style"]):
                script.decompose()
            
            # Get text content
            content = soup.get_text(separator="\n", strip=True)
        
        # Create metadata
        doc_metadata = metadata or {}
        doc_metadata["source"] = "url"
        doc_metadata["url"] = url
        doc_metadata["type"] = "web"
        
        # Split into chunks
        chunks = self._split_into_chunks(content)
        
        # Generate embeddings
        for i, chunk in enumerate(chunks):
            chunk_id = f"{document_id}_{i}"
            embedding = await self.embedding_generator.generate(chunk)
            
            chunk_metadata = {
                **doc_metadata,
                "chunk_index": i,
                "total_chunks": len(chunks),
                "parent_id": document_id
            }
            
            await self.vector_store.add(
                id=chunk_id,
                text=chunk,
                embedding=embedding,
                metadata=chunk_metadata
            )
        
        logger.info(f"Ingested URL: {document_id} with {len(chunks)} chunks")
        return document_id
    
    async def _read_text_file(self, file_path: str) -> str:
        """Read a text file."""
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    
    async def _read_pdf_file(self, file_path: str) -> str:
        """Read a PDF file (basic implementation)."""
        # For a full implementation, you'd use a PDF library like pypdf
        # This is a placeholder
        return f"PDF content from {file_path}"
    
    def _split_into_chunks(self, text: str, chunk_size: int = 1000) -> list:
        """
        Split text into chunks.
        """
        chunks = []
        lines = text.split("\n")
        current_chunk = ""
        
        for line in lines:
            if len(current_chunk) + len(line) > chunk_size:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = line
            else:
                current_chunk += "\n" + line
        
        if current_chunk:
            chunks.append(current_chunk.strip())
        
        return chunks if chunks else [text]