"""
Tool policy enforcement.
"""
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from collections import defaultdict
import threading


class ToolPolicy:
    """
    Policy enforcement for tool usage.
    """
    
    # Allowed tools (can be configured)
    ALLOWED_TOOLS = [
        "web_retrieval",
        "scraper",
        "filesystem"
    ]
    
    # Rate limits (tool_name -> max_calls per minute)
    RATE_LIMITS = {
        "web_retrieval": 10,
        "scraper": 5,
        "filesystem": 20
    }
    
    def __init__(self):
        self._tool_usage: Dict[str, List[datetime]] = defaultdict(list)
        self._lock = threading.Lock()
    
    def is_tool_allowed(self, tool_name: str) -> bool:
        """Check if a tool is allowed by policy."""
        return tool_name in self.ALLOWED_TOOLS
    
    def check_rate_limit(self, tool_name: str) -> bool:
        """
        Check if the tool is within rate limits.
        """
        with self._lock:
            now = datetime.utcnow()
            cutoff = now - timedelta(minutes=1)
            
            # Clean old entries
            self._tool_usage[tool_name] = [
                ts for ts in self._tool_usage[tool_name]
                if ts > cutoff
            ]
            
            # Check limit
            max_calls = self.RATE_LIMITS.get(tool_name, 10)
            return len(self._tool_usage[tool_name]) < max_calls
    
    def record_tool_use(self, tool_name: str):
        """
        Record a tool use for rate limiting.
        """
        with self._lock:
            self._tool_usage[tool_name].append(datetime.utcnow())
    
    def get_remaining_calls(self, tool_name: str) -> int:
        """
        Get remaining API calls for a tool in the current window.
        """
        with self._lock:
            now = datetime.utcnow()
            cutoff = now - timedelta(minutes=1)
            
            self._tool_usage[tool_name] = [
                ts for ts in self._tool_usage[tool_name]
                if ts > cutoff
            ]
            
            max_calls = self.RATE_LIMITS.get(tool_name, 10)
            return max_calls - len(self._tool_usage[tool_name])
    
    @classmethod
    def get_all_policies(cls) -> List[Dict]:
        """
        Get all policy configurations.
        """
        return [
            {
                "tool": tool,
                "allowed": tool in cls.ALLOWED_TOOLS,
                "rate_limit": cls.RATE_LIMITS.get(tool, 10)
            }
            for tool in ["web_retrieval", "scraper", "filesystem"]
        ]
    
    @classmethod
    def add_allowed_tool(cls, tool_name: str):
        """Add a tool to the allowed list."""
        if tool_name not in cls.ALLOWED_TOOLS:
            cls.ALLOWED_TOOLS.append(tool_name)
    
    @classmethod
    def remove_allowed_tool(cls, tool_name: str):
        """Remove a tool from the allowed list."""
        if tool_name in cls.ALLOWED_TOOLS:
            cls.ALLOWED_TOOLS.remove(tool_name)
    
    @classmethod
    def set_rate_limit(cls, tool_name: str, max_calls: int):
        """Set rate limit for a tool."""
        cls.RATE_LIMITS[tool_name] = max_calls