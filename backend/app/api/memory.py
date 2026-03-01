"""
Memory API endpoints.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from app.memory.short_term import ShortTermMemory
from app.memory.long_term import LongTermMemory

router = APIRouter()


class MemoryStoreRequest(BaseModel):
    """Request model for storing memory."""
    content: str
    metadata: Optional[dict] = None


class MemorySearchRequest(BaseModel):
    """Request model for searching memory."""
    query: str
    limit: int = 5


@router.get("/short-term/{client_id}")
async def get_short_term_memory(client_id: str, limit: int = 50):
    """
    Get short-term memory (conversation history) for a client.
    """
    memory = ShortTermMemory(client_id)
    history = await memory.get_conversation(limit=limit)
    
    return {"memory": history}


@router.delete("/short-term/{client_id}")
async def clear_short_term_memory(client_id: str):
    """
    Clear short-term memory for a client.
    """
    memory = ShortTermMemory(client_id)
    await memory.clear()
    
    return {"status": "cleared"}


@router.post("/long-term/")
async def store_long_term_memory(request: MemoryStoreRequest):
    """
    Store a memory in long-term storage.
    """
    memory = LongTermMemory()
    await memory.store(request.content, request.metadata or {})
    
    return {"status": "stored"}


@router.post("/long-term/search")
async def search_long_term_memory(request: MemorySearchRequest):
    """
    Search long-term memory for relevant content.
    """
    memory = LongTermMemory()
    results = await memory.search(request.query, limit=request.limit)
    
    return {"results": results}


@router.get("/long-term/{memory_id}")
async def get_long_term_memory(memory_id: str):
    """
    Get a specific long-term memory by ID.
    """
    memory = LongTermMemory()
    result = await memory.get(memory_id)
    
    if not result:
        raise HTTPException(status_code=404, detail="Memory not found")
    
    return result


@router.delete("/long-term/{memory_id}")
async def delete_long_term_memory(memory_id: str):
    """
    Delete a long-term memory.
    """
    memory = LongTermMemory()
    await memory.delete(memory_id)
    
    return {"status": "deleted"}


@router.get("/summary/{client_id}")
async def get_memory_summary(client_id: str):
    """
    Get a summary of both short-term and long-term memory.
    """
    short_term = ShortTermMemory(client_id)
    long_term = LongTermMemory()
    
    short_term_history = await short_term.get_conversation(limit=10)
    long_term_memories = await long_term.search(client_id, limit=5)
    
    return {
        "short_term": {
            "recent_messages": len(short_term_history)
        },
        "long_term": {
            "relevant_memories": len(long_term_memories)
        }
    }