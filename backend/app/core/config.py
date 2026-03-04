"""Application configuration."""
import os
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # LLM
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    llm_provider: str = "openai"
    llm_model: str = "gpt-4o"
    llm_temperature: float = 0.7
    llm_max_tokens: int = 4096

    # Agent
    agent_name: str = "Atlas"
    agent_personality: str = "personality.txt"

    # WhatsApp
    whatsapp_enabled: bool = False
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_whatsapp_number: Optional[str] = None
    whatsapp_verify_token: str = "verify_token"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Memory
    memory_auto_capture: bool = True
    memory_auto_recall: bool = True
    memory_workspace: str = "./data/workspace"
    embedding_provider: str = "openai"

    # Retrieval
    retrieval_top_k: int = 5
    max_tool_calls: int = 10

    class Config:
        env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
        case_sensitive = False


settings = Settings()
"""Application configuration."""
import os
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # LLM
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    llm_provider: str = "openai"
    llm_small_model: str = "gpt-4o"              # teaching & general use
    llm_deep_model: str = "gpt-4o"               # milestone breakdown generation
    llm_temperature: float = 0.7
    llm_max_tokens: int = 4096

    # Agent
    agent_name: str = "Atlas"
    agent_personality: str = "personality.txt"

    # WhatsApp
    whatsapp_enabled: bool = False
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_whatsapp_number: Optional[str] = None
    whatsapp_verify_token: str = "verify_token"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Memory
    memory_auto_capture: bool = True
    memory_auto_recall: bool = True
    memory_workspace: str = "./data/workspace"
    embedding_provider: str = "openai"

    # Retrieval
    retrieval_top_k: int = 5
    max_tool_calls: int = 10

    class Config:
        env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
        case_sensitive = False


settings = Settings()