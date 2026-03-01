"""
Document Processor — Ingests files into ChromaDB for RAG.

Supported formats: PDF, DOCX, TXT, MD
Each chunk stored with metadata: doc_id, filename, chat_id, chunk_index, page
"""
import hashlib
import uuid
from pathlib import Path
from typing import List, Dict, Optional, Tuple

from app.core.logging import logger


def _chunk_text(text: str, chunk_size: int = 400, overlap: int = 60) -> List[str]:
    """Overlapping word-count chunks. 400 words ≈ 500 tokens."""
    words = text.split()
    if len(words) <= chunk_size:
        return [text.strip()] if text.strip() else []
    chunks = []
    start = 0
    while start < len(words):
        chunk = " ".join(words[start:start + chunk_size])
        if chunk.strip():
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


def extract_text_pdf(filepath: str) -> List[Tuple[str, int]]:
    """Returns list of (page_text, page_num)."""
    try:
        import pypdf
        reader = pypdf.PdfReader(filepath)
        pages = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                pages.append((text.strip(), i + 1))
        return pages
    except Exception as e:
        logger.warning(f"PDF extraction failed: {e}")
        return []


def extract_text_docx(filepath: str) -> List[Tuple[str, int]]:
    """Returns list of (paragraph_text, para_num) grouped into pages."""
    try:
        from docx import Document
        doc = Document(filepath)
        full_text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        return [(full_text, 1)]
    except Exception as e:
        logger.warning(f"DOCX extraction failed: {e}")
        return []


def extract_text_plain(filepath: str) -> List[Tuple[str, int]]:
    """TXT / MD."""
    try:
        text = Path(filepath).read_text(encoding="utf-8", errors="ignore")
        return [(text, 1)] if text.strip() else []
    except Exception as e:
        logger.warning(f"Text extraction failed: {e}")
        return []


def extract_text(filepath: str) -> List[Tuple[str, int]]:
    """Dispatch to the right extractor based on extension."""
    ext = Path(filepath).suffix.lower()
    if ext == ".pdf":
        return extract_text_pdf(filepath)
    elif ext in (".docx", ".doc"):
        return extract_text_docx(filepath)
    elif ext in (".txt", ".md", ".rst", ".csv"):
        return extract_text_plain(filepath)
    else:
        # Try as plain text
        return extract_text_plain(filepath)


class DocumentProcessor:
    """Processes documents and stores chunks in ChromaDB."""

    SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".md", ".rst", ".csv"}

    def __init__(self, collection, db_path: str):
        self.collection = collection   # ChromaDB collection (shared with MemoryManager)
        self.db_path = db_path

    def is_supported(self, filename: str) -> bool:
        return Path(filename).suffix.lower() in self.SUPPORTED_EXTENSIONS

    async def ingest(
        self,
        filepath: str,
        filename: str,
        chat_id: str,
    ) -> Dict:
        """
        Ingest a file: extract → chunk → embed → store in ChromaDB.
        Returns summary dict with doc_id and chunk_count.
        """
        doc_id = str(uuid.uuid4())[:12]
        file_size = Path(filepath).stat().st_size

        logger.info(f"Ingesting {filename} (chat={chat_id}, doc_id={doc_id})")

        # 1. Extract text per page
        pages = extract_text(filepath)
        if not pages:
            raise ValueError(f"Could not extract text from {filename}")

        # 2. Chunk each page
        all_chunks = []
        for page_text, page_num in pages:
            chunks = _chunk_text(page_text, chunk_size=400, overlap=60)
            for i, chunk in enumerate(chunks):
                all_chunks.append({
                    "text": chunk,
                    "page": page_num,
                    "chunk_index": len(all_chunks),
                })

        if not all_chunks:
            raise ValueError(f"No text chunks extracted from {filename}")

        # 3. Store chunks in ChromaDB
        ids = []
        documents = []
        metadatas = []

        for chunk_data in all_chunks:
            chunk_id = hashlib.sha256(
                f"{doc_id}::{chunk_data['chunk_index']}::{chunk_data['text'][:50]}".encode()
            ).hexdigest()[:32]

            ids.append(chunk_id)
            documents.append(chunk_data["text"])
            metadatas.append({
                "type": "document",
                "doc_id": doc_id,
                "filename": filename,
                "chat_id": chat_id,
                "page": chunk_data["page"],
                "chunk_index": chunk_data["chunk_index"],
            })

        # Batch upsert (ChromaDB handles embedding generation)
        batch_size = 50
        for i in range(0, len(ids), batch_size):
            self.collection.upsert(
                ids=ids[i:i + batch_size],
                documents=documents[i:i + batch_size],
                metadatas=metadatas[i:i + batch_size],
            )

        chunk_count = len(all_chunks)
        logger.info(f"Indexed {chunk_count} chunks for {filename}")

        # 4. Save document record to SQLite
        import sqlite3
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """INSERT INTO documents (doc_id, filename, chat_id, chunk_count, file_size)
               VALUES (?, ?, ?, ?, ?)""",
            (doc_id, filename, chat_id, chunk_count, file_size),
        )
        conn.commit()
        conn.close()

        return {
            "doc_id": doc_id,
            "filename": filename,
            "chat_id": chat_id,
            "chunk_count": chunk_count,
            "file_size": file_size,
        }

    def delete(self, doc_id: str) -> bool:
        """Delete all chunks for a document from ChromaDB and SQLite."""
        import sqlite3

        try:
            # Get all chunk IDs for this doc from ChromaDB
            results = self.collection.get(
                where={"doc_id": doc_id},
                include=["metadatas"],
            )
            if results and results["ids"]:
                self.collection.delete(ids=results["ids"])
                logger.info(f"Deleted {len(results['ids'])} chunks for doc {doc_id}")

            # Remove from SQLite
            conn = sqlite3.connect(self.db_path)
            conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.error(f"Document deletion failed: {e}")
            return False

    def list_documents(self, chat_id: Optional[str] = None) -> List[Dict]:
        """List documents, optionally filtered by chat."""
        import sqlite3
        conn = sqlite3.connect(self.db_path)
        if chat_id:
            rows = conn.execute(
                "SELECT doc_id, filename, chat_id, chunk_count, file_size, uploaded_at FROM documents WHERE chat_id = ? ORDER BY uploaded_at DESC",
                (chat_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT doc_id, filename, chat_id, chunk_count, file_size, uploaded_at FROM documents ORDER BY uploaded_at DESC"
            ).fetchall()
        conn.close()
        return [
            {
                "doc_id": r[0],
                "filename": r[1],
                "chat_id": r[2],
                "chunk_count": r[3],
                "file_size": r[4],
                "uploaded_at": r[5],
            }
            for r in rows
        ]