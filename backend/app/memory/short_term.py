"""
Short-term memory management for conversation history.
"""
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import json
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class ShortTermMemory:
    """
    Manages short-term memory (conversation history) for a client.
    """
    
    def __init__(self, client_id: str = "default"):
        self.client_id = client_id
        self.max_messages = settings.short_term_max_messages
        self._messages: List[Dict] = []
        self._load()
    
    def _get_storage_path(self) -> Path:
        """Get the storage path for this client's memory."""
        storage_dir = Path("./data/memory/short_term")
        storage_dir.mkdir(parents=True, exist_ok=True)
        return storage_dir / f"{self.client_id}.json"
    
    def _load(self):
        """Load memory from disk."""
        path = self._get_storage_path()
        if path.exists():
            try:
                with open(path, "r") as f:
                    self._messages = json.load(f)
            except Exception as e:
                logger.error(f"Error loading short-term memory: {e}")
                self._messages = []
    
    def _save(self):
        """Save memory to disk."""
        path = self._get_storage_path()
        try:
            with open(path, "w") as f:
                json.dump(self._messages, f)
        except Exception as e:
            logger.error(f"Error saving short-term memory: {e}")
    
    async def add_message(self, role: str, content: str, metadata: Optional[Dict] = None):
        """
        Add a message to the conversation history.
        """
        message = {
            "role": role,
            "content": content,
            "timestamp": datetime.utcnow().isoformat(),
            "metadata": metadata or {}
        }
        
        self._messages.append(message)
        
        # Trim if exceeds max messages
        if len(self._messages) > self.max_messages:
            self._messages = self._messages[-self.max_messages:]
        
        self._save()
    
    async def get_conversation(self, limit: Optional[int] = None) -> List[Dict]:
        """
        Get the conversation history.
        """
        if limit:
            return self._messages[-limit:]
        return self._messages
    
    async def get_last_message(self) -> Optional[Dict]:
        """Get the last message."""
        return self._messages[-1] if self._messages else None
    
    async def get_messages_since(self, timestamp: datetime) -> List[Dict]:
        """Get messages since a specific timestamp."""
        return [
            msg for msg in self._messages
            if datetime.fromisoformat(msg["timestamp"]) > timestamp
        ]
    
    async def clear(self):
        """Clear the conversation history."""
        self._messages = []
        self._save()
    
    async def get_message_count(self) -> int:
        """Get the number of messages in memory."""
        return len(self._messages)
    
    async def search(self, query: str) -> List[Dict]:
        """
        Search for messages containing a query.
        """
        query_lower = query.lower()
        return [
            msg for msg in self._messages
            if query_lower in msg.get("content", "").lower()
        ]
    
    def get_context_string(self, limit: Optional[int] = None) -> str:
        """
        Get conversation history as a formatted string.
        """
        messages = self._messages[-limit:] if limit else self._messages
        
        context_parts = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            context_parts.append(f"{role}: {content}")
        
        return "\n".join(context_parts)