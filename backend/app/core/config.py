"""
Application configuration using pydantic-settings.
"""
from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    """Application settings."""
    
    # App settings
    app_name: str = "AI Agent"
    debug: bool = False
    
    # OpenAI settings
    openai_api_key: Optional[str] = None
    openai_model: str = "gpt-4"
    openai_temperature: float = 0.7
    openai_max_tokens: int = 2000
    
    # Database settings
    database_url: str = "sqlite+aiosqlite:///./ai_agent.db"
    
    # Vector store settings
    chroma_persist_directory: str = "./chroma_data"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimensions: int = 384
    
    # Memory settings
    short_term_max_messages: int = 50
    long_term_top_k: int = 5
    summary_threshold: int = 10
    
    # Tool settings
    tool_timeout: int = 30
    max_tool_calls: int = 5
    
    # WebSocket settings
    ws_heartbeat_interval: int = 30
    ws_ping_interval: int = 20
    
    # Retrieval settings
    retrieval_top_k: int = 3
    retrieval_similarity_threshold: float = 0.7
    
    class Config:
        env_file = ".env"
        case_sensitive = False


# Global settings instance
settings = Settings()


def get_settings() -> Settings:
    """Get the settings instance."""
    return settings