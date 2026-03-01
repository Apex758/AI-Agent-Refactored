"""
Streaming handler for real-time token delivery.
"""
from typing import Dict, Optional, Any
import asyncio


class StreamingHandler:
    """
    Handles streaming of tokens to WebSocket clients.
    """
    
    def __init__(self, manager, client_id: str):
        self.manager = manager
        self.client_id = client_id
        self.buffer = []
        self.buffer_size = 5
    
    async def send_token(self, token: str):
        """
        Send a token to the client.
        """
        self.buffer.append(token)
        
        # Flush buffer when it reaches the buffer size
        if len(self.buffer) >= self.buffer_size:
            await self.flush()
    
    async def flush(self):
        """
        Flush the buffer and send all pending tokens.
        """
        if self.buffer:
            content = "".join(self.buffer)
            await self.manager.send_message(self.client_id, {
                "type": "token",
                "content": content
            })
            self.buffer = []
    
    async def send_message(self, message_type: str, content: Any):
        """
        Send a message of a specific type.
        """
        await self.manager.send_message(self.client_id, {
            "type": message_type,
            "content": content
        })
    
    async def send_tool_start(self, tool_name: str, params: Dict):
        """
        Notify that a tool is starting execution.
        """
        await self.manager.send_message(self.client_id, {
            "type": "tool_start",
            "tool": tool_name,
            "params": params
        })
    
    async def send_tool_end(self, tool_name: str, result: Any):
        """
        Notify that a tool has finished execution.
        """
        await self.manager.send_message(self.client_id, {
            "type": "tool_end",
            "tool": tool_name,
            "result": result
        })
    
    async def send_tool_error(self, tool_name: str, error: str):
        """
        Notify that a tool has errored.
        """
        await self.manager.send_message(self.client_id, {
            "type": "tool_error",
            "tool": tool_name,
            "error": error
        })
    
    async def send_error(self, error: str):
        """
        Send an error message.
        """
        await self.manager.send_message(self.client_id, {
            "type": "error",
            "content": error
        })
    
    async def send_status(self, status: str):
        """
        Send a status update.
        """
        await self.manager.send_message(self.client_id, {
            "type": "status",
            "content": status
        })
    
    async def finish(self):
        """
        Finish streaming and flush any remaining buffer.
        """
        await self.flush()
        await self.manager.send_message(self.client_id, {
            "type": "complete",
            "content": ""
        })


class TokenBuffer:
    """
    Buffer for managing token streaming.
    """
    
    def __init__(self, flush_interval: float = 0.1):
        self.buffer = ""
        self.flush_interval = flush_interval
    
    async def add(self, token: str):
        """
        Add a token to the buffer.
        """
        self.buffer += token
    
    async def get_and_clear(self) -> str:
        """
        Get the current buffer and clear it.
        """
        result = self.buffer
        self.buffer = ""
        return result
    
    async def flush_if_needed(self, force: bool = False) -> Optional[str]:
        """
        Flush the buffer if it has content.
        """
        if self.buffer and (force or len(self.buffer) > 20):
            return await self.get_and_clear()
        return None