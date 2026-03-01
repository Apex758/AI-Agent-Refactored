"""
Tool registry for managing available tools.
"""
from typing import Dict, List, Optional, Any
from app.tools.policy import ToolPolicy
from app.core.logging import get_logger

logger = get_logger(__name__)


class Tool:
    """Base tool class."""
    
    def __init__(self, name: str, description: str, parameters: Dict = None):
        self.name = name
        self.description = description
        self.parameters = parameters or {}
    
    async def execute(self, **kwargs) -> Any:
        """Execute the tool with given parameters."""
        raise NotImplementedError
    
    def validate_parameters(self, params: Dict) -> bool:
        """Validate tool parameters."""
        return True


class ToolRegistry:
    """
    Registry for managing available tools.
    """
    
    def __init__(self):
        self._tools: Dict[str, Tool] = {}
        self._policy = ToolPolicy()
        self._register_default_tools()
    
    def _register_default_tools(self):
        """Register default tools."""
        from app.tools.impl.web_retrieval import WebRetrievalTool
        from app.tools.impl.scraper import ScraperTool
        from app.tools.impl.filesystem import FilesystemTool
        
        self.register(WebRetrievalTool())
        self.register(ScraperTool())
        self.register(FilesystemTool())
    
    def register(self, tool: Tool):
        """Register a tool."""
        self._tools[tool.name] = tool
        logger.info(f"Registered tool: {tool.name}")
    
    def unregister(self, name: str):
        """Unregister a tool."""
        if name in self._tools:
            del self._tools[name]
            logger.info(f"Unregistered tool: {name}")
    
    def get_tool(self, name: str) -> Optional[Tool]:
        """Get a tool by name."""
        return self._tools.get(name)
    
    def list_tools(self) -> List[Tool]:
        """List all registered tools."""
        return list(self._tools.values())
    
    def get_enabled_tools(self) -> List[Tool]:
        """Get all enabled tools."""
        return [tool for tool in self._tools.values() if self._policy.is_tool_allowed(tool.name)]
    
    async def execute_tool(self, name: str, parameters: Dict) -> Any:
        """
        Execute a tool with policy checks.
        """
        tool = self.get_tool(name)
        
        if not tool:
            raise ValueError(f"Tool '{name}' not found")
        
        # Check policy
        if not self._policy.is_tool_allowed(name):
            raise PermissionError(f"Tool '{name}' is not allowed by policy")
        
        # Check rate limit
        if not self._policy.check_rate_limit(name):
            raise RuntimeError(f"Tool '{name}' has exceeded rate limit")
        
        try:
            result = await tool.execute(**parameters)
            self._policy.record_tool_use(name)
            return result
        except Exception as e:
            logger.error(f"Error executing tool {name}: {e}")
            raise
    
    def get_tool_schemas(self) -> List[Dict]:
        """Get OpenAI function calling schemas for all tools."""
        schemas = []
        for tool in self.get_enabled_tools():
            schemas.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }
            })
        return schemas