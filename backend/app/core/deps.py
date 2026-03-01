"""
Dependency injection for FastAPI.
"""
from functools import lru_cache
from app.agent.orchestrator import AgentOrchestrator
from app.tools.registry import ToolRegistry
from app.retrieval.store import VectorStore
from app.retrieval.embeddings import EmbeddingGenerator


# Singleton instances
_orchestrator: AgentOrchestrator = None
_tool_registry: ToolRegistry = None
_vector_store: VectorStore = None
_embedding_generator: EmbeddingGenerator = None


def get_agent_orchestrator() -> AgentOrchestrator:
    """Get or create the agent orchestrator singleton."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = AgentOrchestrator()
    return _orchestrator


def get_tool_registry() -> ToolRegistry:
    """Get or create the tool registry singleton."""
    global _tool_registry
    if _tool_registry is None:
        _tool_registry = ToolRegistry()
    return _tool_registry


def get_vector_store() -> VectorStore:
    """Get or create the vector store singleton."""
    global _vector_store
    if _vector_store is None:
        _vector_store = VectorStore()
    return _vector_store


def get_embedding_generator() -> EmbeddingGenerator:
    """Get or create the embedding generator singleton."""
    global _embedding_generator
    if _embedding_generator is None:
        _embedding_generator = EmbeddingGenerator()
    return _embedding_generator


def reset_dependencies():
    """Reset all dependency singletons (useful for testing)."""
    global _orchestrator, _tool_registry, _vector_store, _embedding_generator
    _orchestrator = None
    _tool_registry = None
    _vector_store = None
    _embedding_generator = None