"""
Documents API — Upload, list, and delete RAG documents.
"""
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse

from app.memory.manager import get_memory
from app.core.logging import logger

router = APIRouter()

UPLOAD_DIR = Path("./data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    chat_id: str = Form(...),
):
    """Upload a document and ingest it into ChromaDB for the given chat."""
    memory = get_memory()
    processor = memory.get_document_processor()

    if not processor.is_supported(file.filename or ""):
        raise HTTPException(
            400,
            f"Unsupported file type. Supported: PDF, DOCX, TXT, MD, CSV"
        )

    # Read file content
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 50MB)")

    # Save temporarily
    suffix = Path(file.filename or "upload").suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = await processor.ingest(
            filepath=tmp_path,
            filename=file.filename or "unknown",
            chat_id=chat_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.error(f"Ingest error: {e}")
        raise HTTPException(500, f"Ingestion failed: {str(e)}")
    finally:
        os.unlink(tmp_path)


@router.get("")
async def list_documents(chat_id: Optional[str] = None):
    """List documents. Optionally filter by chat_id."""
    memory = get_memory()
    processor = memory.get_document_processor()
    docs = processor.list_documents(chat_id=chat_id)
    return {"documents": docs}


@router.delete("/{doc_id}")
async def delete_document(doc_id: str):
    """Delete a document and all its chunks from ChromaDB."""
    memory = get_memory()
    processor = memory.get_document_processor()
    success = processor.delete(doc_id)
    if not success:
        raise HTTPException(500, "Deletion failed")
    return {"status": "deleted", "doc_id": doc_id}