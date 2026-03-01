"""WebRTC Signaling Handler for real-time voice."""
import json
import logging
from typing import Dict
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class WebRTCHandler:
    """Handles WebRTC signaling for real-time voice communication."""
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def handle_connection(self, websocket: WebSocket):
        """Handle a new WebRTC connection."""
        await websocket.accept()
        client_id = str(id(websocket))
        self.active_connections[client_id] = websocket
        
        logger.info(f"WebRTC client connected: {client_id}")
        
        try:
            while True:
                data = await websocket.receive_text()
                message = json.loads(data)
                await self.handle_message(client_id, message)
        except WebSocketDisconnect:
            logger.info(f"WebRTC client disconnected: {client_id}")
        except Exception as e:
            logger.error(f"WebRTC error: {e}")
        finally:
            if client_id in self.active_connections:
                del self.active_connections[client_id]
    
    async def handle_message(self, client_id: str, message: dict):
        """Handle incoming WebRTC signaling message."""
        msg_type = message.get("type")
        
        if msg_type == "offer":
            await self.handle_offer(client_id, message)
        elif msg_type == "answer":
            await self.handle_answer(client_id, message)
        elif msg_type == "ice_candidate":
            await self.handle_ice_candidate(client_id, message)
        elif msg_type == "audio":
            await self.handle_audio(client_id, message)
        else:
            logger.warning(f"Unknown message type: {msg_type}")
    
    async def handle_offer(self, client_id: str, message: dict):
        """Handle SDP offer - forward to realtime model."""
        sdp = message.get("sdp")
        logger.info(f"Received offer from {client_id}")
        
        # Placeholder: In production, integrate with realtime model
        # For now, just acknowledge
        websocket = self.active_connections.get(client_id)
        if websocket:
            await websocket.send_json({
                "type": "error",
                "message": "Realtime model not configured"
            })
    
    async def handle_answer(self, client_id: str, message: dict):
        """Handle SDP answer from client."""
        sdp = message.get("sdp")
        logger.info(f"Received answer from {client_id}")
        # Forward to realtime model if needed
    
    async def handle_ice_candidate(self, client_id: str, message: dict):
        """Handle ICE candidate from client."""
        candidate = message.get("candidate")
        logger.debug(f"Received ICE candidate from {client_id}")
        # Forward to realtime model
    
    async def handle_audio(self, client_id: str, message: dict):
        """Handle incoming audio data from client."""
        audio_data = message.get("data")
        # Forward audio to realtime model for processing


# Global WebRTC handler
webrtc_handler = WebRTCHandler()


async def webrtc_websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for WebRTC signaling."""
    await webrtc_handler.handle_connection(websocket)