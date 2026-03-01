"""
WebSocket API for real-time communication.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set
import json
import asyncio

from app.agent.orchestrator import AgentOrchestrator
from app.agent.streaming import StreamingHandler
from app.core.deps import get_agent_orchestrator

router = APIRouter()


class ConnectionManager:
    """Manages active WebSocket connections."""
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[client_id] = websocket
    
    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
    
    async def send_message(self, client_id: str, message: dict):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_json(message)
    
    async def send_text(self, client_id: str, text: str):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_text(text)


manager = ConnectionManager()


@router.websocket("/chat/{client_id}")
async def websocket_chat(websocket: WebSocket, client_id: str):
    """
    WebSocket endpoint for real-time chat.
    """
    await manager.connect(client_id, websocket)
    
    orchestrator = get_agent_orchestrator()
    streaming_handler = StreamingHandler(manager, client_id)
    
    try:
        # Send welcome message
        await manager.send_message(client_id, {
            "type": "system",
            "content": "Connected to AI Agent. How can I help you today?"
        })
        
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            user_message = message_data.get("message", "")
            
            if not user_message:
                continue
            
            # Send acknowledgment
            await manager.send_message(client_id, {
                "type": "status",
                "content": "processing"
            })
            
            # Process message through orchestrator
            async for chunk in orchestrator.process_message(
                user_message, 
                client_id=client_id,
                streaming_handler=streaming_handler
            ):
                if chunk.get("type") == "token":
                    await manager.send_message(client_id, {
                        "type": "token",
                        "content": chunk.get("content", "")
                    })
                elif chunk.get("type") == "tool_call":
                    await manager.send_message(client_id, {
                        "type": "tool_call",
                        "tool": chunk.get("tool"),
                        "status": chunk.get("status")
                    })
            
            # Send completion message
            await manager.send_message(client_id, {
                "type": "status",
                "content": "complete"
            })
            
    except WebSocketDisconnect:
        manager.disconnect(client_id)
    except Exception as e:
        await manager.send_message(client_id, {
            "type": "error",
            "content": str(e)
        })
        manager.disconnect(client_id)


@router.websocket("/stream/{client_id}")
async def websocket_stream(websocket: WebSocket, client_id: str):
    """
    WebSocket endpoint for streaming responses only.
    """
    await manager.connect(client_id, websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            # Handle streaming control messages
            if message_data.get("type") == "ping":
                await manager.send_message(client_id, {"type": "pong"})
                
    except WebSocketDisconnect:
        manager.disconnect(client_id)