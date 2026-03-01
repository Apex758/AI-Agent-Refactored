"""
Database models using SQLAlchemy.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, Text, DateTime, Integer, JSON, Boolean
from sqlalchemy.sql import func

from app.db.session import Base


class Conversation(Base):
    """Conversation model."""
    __tablename__ = "conversations"
    
    id = Column(String(36), primary_key=True)
    client_id = Column(String(255), nullable=False, index=True)
    created_at = Column(DateTime, default=func.utcnow)
    updated_at = Column(DateTime, default=func.utcnow, onupdate=func.utcnow)
    title = Column(String(500), nullable=True)
    metadata = Column(JSON, default={})
    
    def __repr__(self):
        return f"<Conversation {self.id}>"


class Message(Base):
    """Message model."""
    __tablename__ = "messages"
    
    id = Column(String(36), primary_key=True)
    conversation_id = Column(String(36), nullable=False, index=True)
    role = Column(String(50), nullable=False)  # user, assistant, system
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=func.utcnow)
    metadata = Column(JSON, default={})
    
    def __repr__(self):
        return f"<Message {self.id} role={self.role}>"


class Document(Base):
    """Document model for ingested documents."""
    __tablename__ = "documents"
    
    id = Column(String(36), primary_key=True)
    source = Column(String(255), nullable=False)
    source_type = Column(String(50), nullable=False)  # text, file, url
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=func.utcnow)
    metadata = Column(JSON, default={})
    indexed = Column(Boolean, default=False)
    
    def __repr__(self):
        return f"<Document {self.id} source={self.source}>"


class ToolUsage(Base):
    """Tool usage tracking model."""
    __tablename__ = "tool_usage"
    
    id = Column(String(36), primary_key=True)
    tool_name = Column(String(100), nullable=False, index=True)
    client_id = Column(String(255), nullable=False, index=True)
    parameters = Column(JSON, default={})
    result = Column(JSON, default={})
    success = Column(Boolean, default=True)
    error = Column(String(1000), nullable=True)
    created_at = Column(DateTime, default=func.utcnow)
    duration_ms = Column(Integer, nullable=True)
    
    def __repr__(self):
        return f"<ToolUsage {self.id} tool={self.tool_name}>"


class UserSession(Base):
    """User session model."""
    __tablename__ = "user_sessions"
    
    id = Column(String(36), primary_key=True)
    client_id = Column(String(255), nullable=False, index=True)
    started_at = Column(DateTime, default=func.utcnow)
    last_active = Column(DateTime, default=func.utcnow, onupdate=func.utcnow)
    ended_at = Column(DateTime, nullable=True)
    metadata = Column(JSON, default={})
    
    def __repr__(self):
        return f"<UserSession {self.id}>"


class Memory(Base):
    """Long-term memory model."""
    __tablename__ = "memories"
    
    id = Column(String(36), primary_key=True)
    client_id = Column(String(255), nullable=False, index=True)
    content = Column(Text, nullable=False)
    memory_type = Column(String(50), default="general")  # general, preference, fact
    importance = Column(Integer, default=1)  # 1-5 scale
    created_at = Column(DateTime, default=func.utcnow)
    accessed_at = Column(DateTime, nullable=True)
    access_count = Column(Integer, default=0)
    metadata = Column(JSON, default={})
    
    def __repr__(self):
        return f"<Memory {self.id} type={self.memory_type}>"