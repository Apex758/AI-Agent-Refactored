"""
Tool Registry — Manages tools the agent can use.
Includes built-in tools + memory tools + custom skill loading.
"""
import httpx
import os
from typing import Dict, List, Optional, Any, Callable
from pathlib import Path

from app.core.logging import logger


class Tool:
    """A tool the agent can call."""

    def __init__(self, name: str, description: str, parameters: Dict, handler: Callable):
        self.name = name
        self.description = description
        self.parameters = parameters
        self.handler = handler

    def get_schema(self) -> Dict:
        """OpenAI function-calling schema."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    async def execute(self, **kwargs) -> Any:
        return await self.handler(**kwargs)


class ToolRegistry:
    """Registry of all available tools."""

    def __init__(self):
        self._tools: Dict[str, Tool] = {}
        self._register_builtins()

    def register(self, tool: Tool):
        self._tools[tool.name] = tool
        logger.info(f"Registered tool: {tool.name}")

    def get(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def list_tools(self) -> List[Tool]:
        return list(self._tools.values())

    def get_tool_schemas(self) -> List[Dict]:
        return [t.get_schema() for t in self._tools.values()]

    async def execute(self, name: str, args: Dict) -> Any:
        tool = self._tools.get(name)
        if not tool:
            raise ValueError(f"Tool '{name}' not found")
        return await tool.execute(**args)

    def _register_builtins(self):
        """Register all built-in tools."""

        # ── Web Search ──
        self.register(Tool(
            name="web_search",
            description="Search the web for current information",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                },
                "required": ["query"],
            },
            handler=self._web_search,
        ))

        # ── Web Fetch ──
        self.register(Tool(
            name="web_fetch",
            description="Fetch and extract text content from a URL",
            parameters={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to fetch"},
                },
                "required": ["url"],
            },
            handler=self._web_fetch,
        ))

        # ── Filesystem Read ──
        self.register(Tool(
            name="read_file",
            description="Read a file from the workspace",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to workspace"},
                },
                "required": ["path"],
            },
            handler=self._read_file,
        ))

        # ── Filesystem Write ──
        self.register(Tool(
            name="write_file",
            description="Write content to a file in the workspace",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path"},
                    "content": {"type": "string", "description": "Content to write"},
                },
                "required": ["path", "content"],
            },
            handler=self._write_file,
        ))

        # ── Shell Command ──
        self.register(Tool(
            name="run_command",
            description="Run a shell command (use carefully)",
            parameters={
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to execute"},
                },
                "required": ["command"],
            },
            handler=self._run_command,
        ))

        # ── Memory Tools ──
        self.register(Tool(
            name="memory_store",
            description="Store important information in persistent memory (preferences, facts, decisions)",
            parameters={
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "Information to remember"},
                    "tags": {"type": "string", "description": "Comma-separated tags", "default": ""},
                },
                "required": ["content"],
            },
            handler=self._memory_store,
        ))

        self.register(Tool(
            name="memory_search",
            description="Search stored memories semantically",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                },
                "required": ["query"],
            },
            handler=self._memory_search,
        ))

        self.register(Tool(
            name="memory_get",
            description="Read a specific memory file (MEMORY.md or daily logs)",
            parameters={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "File to read (e.g., MEMORY.md)", "default": "MEMORY.md"},
                },
                "required": [],
            },
            handler=self._memory_get,
        ))

    # ── Built-in Tool Handlers ───────────────────────────────────────

    async def _web_search(self, query: str) -> Dict:
        """Search using DuckDuckGo (free, no API key)."""
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    "https://html.duckduckgo.com/html/",
                    params={"q": query},
                    headers={"User-Agent": "Mozilla/5.0"},
                    timeout=10,
                )
                if resp.status_code == 200:
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(resp.text, "html.parser")
                    results = []
                    for r in soup.select(".result")[:5]:
                        title_el = r.select_one(".result__title")
                        snippet_el = r.select_one(".result__snippet")
                        link_el = r.select_one(".result__url")
                        results.append({
                            "title": title_el.get_text(strip=True) if title_el else "",
                            "snippet": snippet_el.get_text(strip=True) if snippet_el else "",
                            "url": link_el.get_text(strip=True) if link_el else "",
                        })
                    return {"results": results, "query": query}
                return {"error": f"Search failed: {resp.status_code}"}
        except Exception as e:
            return {"error": str(e)}

    async def _web_fetch(self, url: str) -> Dict:
        """Fetch and extract text from a URL."""
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=15, follow_redirects=True,
                    headers={"User-Agent": "Mozilla/5.0"})
                if resp.status_code == 200:
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for s in soup(["script", "style"]):
                        s.decompose()
                    text = soup.get_text(separator="\n", strip=True)[:5000]
                    title = soup.title.string if soup.title else ""
                    return {"url": url, "title": title, "content": text}
                return {"error": f"Fetch failed: {resp.status_code}"}
        except Exception as e:
            return {"error": str(e)}

    async def _read_file(self, path: str) -> Dict:
        """Read file from workspace."""
        from app.core.config import settings
        workspace = Path(settings.memory_workspace)
        full_path = (workspace / path).resolve()

        # Security: stay within workspace
        if not str(full_path).startswith(str(workspace.resolve())):
            return {"error": "Access denied"}
        if not full_path.exists():
            return {"error": f"File not found: {path}"}

        try:
            content = full_path.read_text()[:10000]
            return {"path": path, "content": content}
        except Exception as e:
            return {"error": str(e)}

    async def _write_file(self, path: str, content: str) -> Dict:
        """Write file to workspace."""
        from app.core.config import settings
        workspace = Path(settings.memory_workspace)
        full_path = (workspace / path).resolve()

        if not str(full_path).startswith(str(workspace.resolve())):
            return {"error": "Access denied"}

        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content)
        return {"status": "written", "path": path, "size": len(content)}

    async def _run_command(self, command: str) -> Dict:
        """Execute a shell command."""
        import asyncio
        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
            return {
                "stdout": stdout.decode()[:3000],
                "stderr": stderr.decode()[:1000],
                "returncode": proc.returncode,
            }
        except asyncio.TimeoutError:
            return {"error": "Command timed out (30s)"}
        except Exception as e:
            return {"error": str(e)}

    async def _memory_store(self, content: str, tags: str = "") -> Dict:
        from app.memory.manager import get_memory
        result = await get_memory().memory_store(content, tags)
        return {"status": "stored", "summary": result}

    async def _memory_search(self, query: str) -> Dict:
        from app.memory.manager import get_memory
        result = await get_memory().memory_search_tool(query)
        return {"results": result}

    async def _memory_get(self, file_path: str = "MEMORY.md") -> Dict:
        from app.memory.manager import get_memory
        content = await get_memory().memory_get(file_path)
        return {"content": content}


# Singleton
_registry: Optional[ToolRegistry] = None

def get_tool_registry() -> ToolRegistry:
    global _registry
    if _registry is None:
        _registry = ToolRegistry()
    return _registry
