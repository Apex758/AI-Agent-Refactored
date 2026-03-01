"""
Chat API endpoints.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from app.agent.orchestrator import AgentOrchestrator
from app.core.deps import get_agent_orchestrator

router = APIRouter()


class ChatRequest(BaseModel):
    """Request model for chat endpoint."""
    message: str
    client_id: Optional[str] = "default"
    context: Optional[dict] = None


class ChatResponse(BaseModel):
    """Response model for chat endpoint."""
    message: str
    tool_calls: Optional[List[dict]] = None
    sources: Optional[List[str]] = None


@router.post("/", response_model=ChatResponse)
async def send_message(request: ChatRequest):
    """
    Send a message to the agent and get a response.
    """
    orchestrator = get_agent_orchestrator()
    
    try:
        response = await orchestrator.process_message(
            request.message,
            client_id=request.client_id
        )
        
        return ChatResponse(
            message=response.get("message", ""),
            tool_calls=response.get("tool_calls"),
            sources=response.get("sources")
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history/{client_id}")
async def get_history(client_id: str, limit: int = 50):
    """
    Get chat history for a client.
    """
    from app.memory.short_term import ShortTermMemory
    
    memory = ShortTermMemory(client_id)
    history = await memory.get_conversation(limit=limit)
    
    return {"history": history}


@router.delete("/history/{client_id}")
async def clear_history(client_id: str):
    """
    Clear chat history for a client.
    """
    from app.memory.short_term import ShortTermMemory
    
    memory = ShortTermMemory(client_id)
    await memory.clear()
    
    return {"status": "cleared"}