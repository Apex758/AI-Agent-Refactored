"""
Chats API — CRUD for chat sessions.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sqlite3
import uuid
from datetime import datetime

from app.memory.manager import get_memory

router = APIRouter()


class CreateChatRequest(BaseModel):
    name: str = ""


class RenameRequest(BaseModel):
    name: str


@router.get("")
async def list_chats():
    memory = get_memory()
    conn = sqlite3.connect(str(memory.db_path))
    rows = conn.execute(
        "SELECT id, name, created_at FROM chats ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return {"chats": [{"id": r[0], "name": r[1], "created_at": r[2]} for r in rows]}


@router.post("")
async def create_chat(request: CreateChatRequest):
    memory = get_memory()
    chat_id = str(uuid.uuid4())[:8]
    name = request.name.strip() or f"Chat {datetime.now().strftime('%b %d %H:%M')}"
    conn = sqlite3.connect(str(memory.db_path))
    conn.execute(
        "INSERT INTO chats (id, name, created_at) VALUES (?, ?, ?)",
        (chat_id, name, datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()
    return {"id": chat_id, "name": name, "created_at": datetime.now().isoformat()}


@router.patch("/{chat_id}")
async def rename_chat(chat_id: str, request: RenameRequest):
    memory = get_memory()
    conn = sqlite3.connect(str(memory.db_path))
    conn.execute("UPDATE chats SET name = ? WHERE id = ?", (request.name, chat_id))
    conn.commit()
    conn.close()
    return {"status": "updated"}


@router.delete("/{chat_id}")
async def delete_chat(chat_id: str):
    memory = get_memory()
    conn = sqlite3.connect(str(memory.db_path))
    conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
    conn.execute("DELETE FROM conversations WHERE client_id = ?", (chat_id,))
    conn.commit()
    conn.close()
    # Remove memory file
    chat_mem = memory.chats_dir / f"{chat_id}.md"
    if chat_mem.exists():
        chat_mem.unlink()
    return {"status": "deleted"}


@router.get("/{chat_id}/memory")
async def get_chat_memory(chat_id: str):
    memory = get_memory()
    return {"content": memory.get_chat_memory(chat_id)}


@router.get("/search")
async def search_chats(q: str, limit: int = 5):
    """Search across all chat memory files by keywords."""
    memory = get_memory()
    results = memory.search_all_chats(q, limit=limit)
    return {"results": results}
