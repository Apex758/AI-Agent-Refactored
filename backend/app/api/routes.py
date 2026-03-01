"""
API Routes — REST endpoints + WebSocket for real-time web chat.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict
import json

from app.agent.gateway import get_gateway
from app.memory.manager import get_memory
from app.tools.registry import get_tool_registry
from app.core.logging import logger
from app.core.config import settings

router = APIRouter()


@router.get("/config")
async def get_config():
    return {
        "agent_name": settings.agent_name,
        "agent_personality": settings.agent_personality,
    }


class ChatRequest(BaseModel):
    message: str
    client_id: str = "default"


class ChatResponse(BaseModel):
    message: str
    client_id: str
    citations: list = []


class MemoryStoreRequest(BaseModel):
    content: str
    tags: str = ""


class MemorySearchRequest(BaseModel):
    query: str
    top_k: int = 5


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    gateway = get_gateway()
    result = await gateway.process(request.message, client_id=request.client_id, channel="web")
    return ChatResponse(
        message=result["response"],
        client_id=request.client_id,
        citations=result.get("citations", []),
    )


class ConnectionManager:
    def __init__(self):
        self.connections: Dict[str, WebSocket] = {}

    async def connect(self, client_id: str, ws: WebSocket):
        await ws.accept()
        self.connections[client_id] = ws

    def disconnect(self, client_id: str):
        self.connections.pop(client_id, None)

    async def send(self, client_id: str, data: dict):
        ws = self.connections.get(client_id)
        if ws:
            await ws.send_json(data)


ws_manager = ConnectionManager()


@router.websocket("/ws/{client_id}")
async def websocket_chat(ws: WebSocket, client_id: str):
    await ws_manager.connect(client_id, ws)
    gateway = get_gateway()

    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            user_message = msg.get("message", "").strip()
            if not user_message:
                continue

            await ws_manager.send(client_id, {"type": "status", "content": "processing"})

            try:
                full_response = ""
                async for event in gateway.process_stream(user_message, client_id=client_id, channel="web"):
                    if event["type"] == "citations":
                        # Send citations before tokens so frontend can display them
                        await ws_manager.send(client_id, {
                            "type": "citations",
                            "citations": event["citations"],
                        })
                    elif event["type"] == "token":
                        full_response += event["content"]
                        await ws_manager.send(client_id, {"type": "token", "content": event["content"]})

                await ws_manager.send(client_id, {"type": "complete", "content": full_response})

            except Exception as e:
                logger.error(f"Stream error: {e}")
                result = await gateway.process(user_message, client_id=client_id, channel="web")
                await ws_manager.send(client_id, {
                    "type": "complete",
                    "content": result["response"],
                    "citations": result.get("citations", []),
                })

    except WebSocketDisconnect:
        ws_manager.disconnect(client_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        ws_manager.disconnect(client_id)


@router.get("/memory")
async def get_memory_file():
    memory = get_memory()
    return {"content": memory.get_memory_file()}


@router.put("/memory")
async def update_memory_file(content: str):
    memory = get_memory()
    memory.update_memory_file(content)
    return {"status": "updated"}


@router.post("/memory/store")
async def store_memory(request: MemoryStoreRequest):
    memory = get_memory()
    result = await memory.memory_store(request.content, request.tags)
    return {"status": "stored", "result": result}


@router.post("/memory/search")
async def search_memory(request: MemorySearchRequest):
    memory = get_memory()
    results = await memory.search(request.query, top_k=request.top_k)
    return {"results": results}


@router.get("/memory/daily/{date}")
async def get_daily_log(date: str):
    from datetime import date as d
    memory = get_memory()
    try:
        log_date = d.fromisoformat(date)
        return {"content": memory.get_daily_log(log_date)}
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD")


@router.get("/history/{client_id}")
async def get_history(client_id: str, limit: int = 50):
    memory = get_memory()
    return {"history": memory.get_history(client_id, limit)}


@router.delete("/history/{client_id}")
async def clear_history(client_id: str):
    memory = get_memory()
    memory.clear_history(client_id)
    return {"status": "cleared"}


@router.get("/tools")
async def list_tools():
    registry = get_tool_registry()
    return {"tools": [
        {"name": t.name, "description": t.description}
        for t in registry.list_tools()
    ]}


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "agent": get_gateway().get_personality()[:100],
        "tools": len(get_tool_registry().list_tools()),
    }