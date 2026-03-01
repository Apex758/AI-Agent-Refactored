"""
Data models for the agent.
"""
from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum


class MessageRole(str, Enum):
    """Message role enumeration."""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"


class Message(BaseModel):
    """Chat message model."""
    role: MessageRole
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ToolCall(BaseModel):
    """Tool call model."""
    id: str
    name: str
    parameters: Dict[str, Any] = Field(default_factory=dict)
    result: Optional[Any] = None
    status: str = "pending"  # pending, running, completed, error
    error: Optional[str] = None


class AgentState(BaseModel):
    """Agent state model."""
    client_id: str
    messages: List[Message] = Field(default_factory=list)
    tool_calls: List[ToolCall] = Field(default_factory=list)
    context: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AgentResponse(BaseModel):
    """Agent response model."""
    message: str
    tool_calls: List[ToolCall] = Field(default_factory=list)
    sources: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ToolDefinition(BaseModel):
    """Tool definition model."""
    name: str
    description: str
    parameters: Dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class RetrievalResult(BaseModel):
    """Retrieval result model."""
    content: str
    source: str
    score: float = 0.0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class MemoryItem(BaseModel):
    """Memory item model."""
    id: str
    content: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ConversationContext(BaseModel):
    """Conversation context model."""
    client_id: str
    messages: List[Message] = Field(default_factory=list)
    short_term_memories: List[MemoryItem] = Field(default_factory=list)
    long_term_memories: List[MemoryItem] = Field(default_factory=list)
    retrieved_context: List[RetrievalResult] = Field(default_factory=list)