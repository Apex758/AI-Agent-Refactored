"""
Ingest API endpoints for document processing and embedding.
"""
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional
import os
import tempfile

from app.retrieval.ingest import DocumentIngestor
from app.retrieval.embeddings import EmbeddingGenerator

router = APIRouter()


class IngestRequest(BaseModel):
    """Request model for text ingestion."""
    text: str
    source: str = "manual"
    metadata: Optional[dict] = None


class IngestResponse(BaseModel):
    """Response model for ingestion."""
    success: bool
    document_id: str
    chunks: int


@router.post("/text", response_model=IngestResponse)
async def ingest_text(request: IngestRequest):
    """
    Ingest text content and create embeddings.
    """
    try:
        ingestor = DocumentIngestor()
        document_id = await ingestor.ingest_text(
            request.text,
            source=request.source,
            metadata=request.metadata or {}
        )
        
        return IngestResponse(
            success=True,
            document_id=document_id,
            chunks=1
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/file")
async def ingest_file(file: UploadFile = File(...)):
    """
    Ingest a file (PDF, TXT, etc.) and create embeddings.
    """
    # Save uploaded file temporarily
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        ingestor = DocumentIngestor()
        document_id = await ingestor.ingest_file(tmp_path, metadata={"filename": file.filename})
        
        return {
            "success": True,
            "document_id": document_id,
            "filename": file.filename
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)


@router.post("/url")
async def ingest_url(url: str, metadata: Optional[dict] = None):
    """
    Ingest content from a URL.
    """
    try:
        ingestor = DocumentIngestor()
        document_id = await ingestor.ingest_url(url, metadata or {})
        
        return {
            "success": True,
            "document_id": document_id,
            "url": url
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{document_id}")
async def get_ingest_status(document_id: str):
    """
    Get the status of an ingested document.
    """
    from app.retrieval.store import VectorStore
    
    store = VectorStore()
    status = await store.get_document_status(document_id)
    
    if not status:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return status


@router.delete("/{document_id}")
async def delete_document(document_id: str):
    """
    Delete an ingested document and its embeddings.
    """
    try:
        from app.retrieval.store import VectorStore
        
        store = VectorStore()
        await store.delete_document(document_id)
        
        return {"status": "deleted", "document_id": document_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/")
async def list_documents():
    """
    List all ingested documents.
    """
    from app.retrieval.store import VectorStore
    
    store = VectorStore()
    documents = await store.list_documents()
    
    return {"documents": documents}