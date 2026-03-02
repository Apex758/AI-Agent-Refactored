"""
Tool Registry — Manages tools the agent can use.
"""
import httpx
import os
from typing import Dict, List, Optional, Any, Callable
from pathlib import Path

from app.core.logging import logger


class Tool:
    def __init__(self, name: str, description: str, parameters: Dict, handler: Callable):
        self.name = name
        self.description = description
        self.parameters = parameters
        self.handler = handler

    def get_schema(self) -> Dict:
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
        self.register(Tool(
            name="web_search",
            description="Search the web for current information",
            parameters={"type": "object", "properties": {
                "query": {"type": "string", "description": "Search query"},
            }, "required": ["query"]},
            handler=self._web_search,
        ))

        self.register(Tool(
            name="web_fetch",
            description="Fetch and extract text content from a URL",
            parameters={"type": "object", "properties": {
                "url": {"type": "string", "description": "URL to fetch"},
            }, "required": ["url"]},
            handler=self._web_fetch,
        ))

        self.register(Tool(
            name="read_file",
            description="Read a file from the workspace",
            parameters={"type": "object", "properties": {
                "path": {"type": "string", "description": "File path relative to workspace"},
            }, "required": ["path"]},
            handler=self._read_file,
        ))

        self.register(Tool(
            name="write_file",
            description="Write content to a file in the workspace",
            parameters={"type": "object", "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            }, "required": ["path", "content"]},
            handler=self._write_file,
        ))

        self.register(Tool(
            name="run_command",
            description="Run a shell command",
            parameters={"type": "object", "properties": {
                "command": {"type": "string"},
            }, "required": ["command"]},
            handler=self._run_command,
        ))

        self.register(Tool(
            name="memory_store",
            description="Store important information in persistent memory",
            parameters={"type": "object", "properties": {
                "content": {"type": "string", "description": "Information to remember"},
                "tags": {"type": "string", "default": ""},
            }, "required": ["content"]},
            handler=self._memory_store,
        ))

        self.register(Tool(
            name="memory_search",
            description="Search stored memories semantically",
            parameters={"type": "object", "properties": {
                "query": {"type": "string"},
            }, "required": ["query"]},
            handler=self._memory_search,
        ))

        self.register(Tool(
            name="memory_get",
            description="Read a specific memory file (MEMORY.md or daily logs)",
            parameters={"type": "object", "properties": {
                "file_path": {"type": "string", "default": "MEMORY.md"},
            }, "required": []},
            handler=self._memory_get,
        ))

        self.register(Tool(
            name="search_all_chats",
            description=(
                "Search across all past chat sessions by keywords. "
                "Use this when the user references something from a previous conversation. "
                "Returns matching chat summaries and key facts."
            ),
            parameters={"type": "object", "properties": {
                "query": {"type": "string", "description": "Keywords to search for across all chats"},
                "limit": {"type": "integer", "default": 5},
            }, "required": ["query"]},
            handler=self._search_all_chats,
        ))

        self.register(Tool(
            name="get_chat_memory",
            description="Read the full memory file for a specific past chat by chat_id",
            parameters={"type": "object", "properties": {
                "chat_id": {"type": "string", "description": "The chat ID to retrieve memory for"},
            }, "required": ["chat_id"]},
            handler=self._get_chat_memory,
        ))

        # ── Milestone auto-assessment tool ──
        self.register(Tool(
            name="milestone_check",
            description=(
                "Record whether the student answered correctly on the current milestone. "
                "Call this after every student reply during a learning session. "
                "Pass correct=true if they demonstrated understanding, correct=false if not. "
                "The system will automatically advance the milestone when mastery is achieved."
            ),
            parameters={"type": "object", "properties": {
                "chat_id": {"type": "string", "description": "The current chat/session ID"},
                "correct": {"type": "boolean", "description": "True if the student answered correctly"},
            }, "required": ["chat_id", "correct"]},
            handler=self._milestone_check,
        ))

        # ── Learning plan creation tool ──
        self.register(Tool(
            name="create_learning_plan",
            description=(
                "Save the milestone learning plan you just presented to the student. "
                "Call this immediately after presenting the 5-milestone learning path. "
                "Pass the full title and description for each milestone."
            ),
            parameters={"type": "object", "properties": {
                "chat_id": {"type": "string"},
                "topic": {"type": "string"},
                "subject": {"type": "string", "default": "General"},
                "milestones": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "description": {"type": "string"}
                        }
                    }
                }
            }, "required": ["chat_id", "topic", "milestones"]},
            handler=self._create_learning_plan,
        ))

    # ── Handlers ─────────────────────────────────────────────────────

    async def _web_search(self, query: str) -> Dict:
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
                        results.append({
                            "title": (r.select_one(".result__title") or type('', (), {'get_text': lambda *a, **k: ''})()).get_text(strip=True),
                            "snippet": (r.select_one(".result__snippet") or type('', (), {'get_text': lambda *a, **k: ''})()).get_text(strip=True),
                            "url": (r.select_one(".result__url") or type('', (), {'get_text': lambda *a, **k: ''})()).get_text(strip=True),
                        })
                    return {"results": results, "query": query}
                return {"error": f"Search failed: {resp.status_code}"}
        except Exception as e:
            return {"error": str(e)}

    async def _web_fetch(self, url: str) -> Dict:
        """Fetch URL, extract text, images, and YouTube video IDs."""
        import re as _re
        YT_RE = _re.compile(
            r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]{11})'
        )
        SKIP_PATTERNS = ('pixel', 'tracking', 'analytics', 'beacon', 'data:', 'base64',
                         '.ico', 'favicon', 'logo', '1x1', 'blank')

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=15, follow_redirects=True,
                    headers={"User-Agent": "Mozilla/5.0"})
                if resp.status_code == 200:
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(resp.text, "html.parser")

                    images: list = []
                    for img in soup.find_all("img", src=True):
                        src: str = img["src"].strip()
                        if src.startswith("//"):
                            src = "https:" + src
                        elif src.startswith("/"):
                            from urllib.parse import urlparse
                            parsed = urlparse(url)
                            src = f"{parsed.scheme}://{parsed.netloc}{src}"
                        if not src.startswith("http"):
                            continue
                        sl = src.lower()
                        if any(p in sl for p in SKIP_PATTERNS):
                            continue
                        if src not in images:
                            images.append(src)
                        if len(images) >= 6:
                            break

                    videos: list = []
                    for tag in soup.find_all(["a", "iframe"], href=True if True else False):
                        href = tag.get("href") or tag.get("src") or ""
                        m = YT_RE.search(href)
                        if m and m.group(1) not in videos:
                            videos.append(m.group(1))
                        if len(videos) >= 4:
                            break
                    if len(videos) < 4:
                        for m in YT_RE.finditer(resp.text):
                            vid = m.group(1)
                            if vid not in videos:
                                videos.append(vid)
                            if len(videos) >= 4:
                                break

                    for s in soup(["script", "style"]):
                        s.decompose()
                    text = soup.get_text(separator="\n", strip=True)[:5000]

                    return {
                        "url": url,
                        "title": soup.title.string if soup.title else "",
                        "content": text,
                        "images": images,
                        "videos": videos,
                    }
                return {"error": f"Fetch failed: {resp.status_code}"}
        except Exception as e:
            return {"error": str(e)}

    async def _read_file(self, path: str) -> Dict:
        from app.core.config import settings
        workspace = Path(settings.memory_workspace)
        full_path = (workspace / path).resolve()
        if not str(full_path).startswith(str(workspace.resolve())):
            return {"error": "Access denied"}
        if not full_path.exists():
            return {"error": f"File not found: {path}"}
        try:
            return {"path": path, "content": full_path.read_text()[:10000]}
        except Exception as e:
            return {"error": str(e)}

    async def _write_file(self, path: str, content: str) -> Dict:
        from app.core.config import settings
        workspace = Path(settings.memory_workspace)
        full_path = (workspace / path).resolve()
        if not str(full_path).startswith(str(workspace.resolve())):
            return {"error": "Access denied"}
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content)
        return {"status": "written", "path": path, "size": len(content)}

    async def _run_command(self, command: str) -> Dict:
        import asyncio
        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
            return {"stdout": stdout.decode()[:3000], "stderr": stderr.decode()[:1000], "returncode": proc.returncode}
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

    async def _search_all_chats(self, query: str, limit: int = 5) -> Dict:
        from app.memory.manager import get_memory
        results = get_memory().search_all_chats(query, limit=limit)
        if not results:
            return {"message": "No matching chats found.", "results": []}
        return {"results": results}

    async def _get_chat_memory(self, chat_id: str) -> Dict:
        from app.memory.manager import get_memory
        content = get_memory().get_chat_memory(chat_id)
        if not content:
            return {"error": f"No memory found for chat {chat_id}"}
        return {"chat_id": chat_id, "content": content}

    async def _milestone_check(self, chat_id: str, correct: bool) -> Dict:
        """
        Record a check on the current milestone for the given chat.
        Automatically advances if mastery threshold is met.
        """
        try:
            from app.milestones.milestone_store import get_milestone_store
            store = get_milestone_store()
            plans = store.list_plans_for_chat(chat_id)
            if not plans:
                return {"message": "No active milestone plan found for this chat."}

            # Use the most recent in-progress plan
            plan = plans[0]
            current = plan.current_milestone()
            if not current:
                return {"message": "All milestones already mastered!", "plan_id": plan.plan_id}

            current.record_check(correct)
            advanced = False
            if current.check_mastery():
                plan.advance()
                advanced = True

            store.save_plan(plan)

            next_milestone = plan.current_milestone()
            return {
                "plan_id": plan.plan_id,
                "topic": plan.topic,
                "checked_milestone": current.title,
                "correct": correct,
                "advanced": advanced,
                "next_milestone": next_milestone.title if next_milestone else None,
                "progress_pct": round(plan.progress * 100),
                "all_mastered": plan.progress >= 1.0,
            }
        except Exception as e:
            logger.error(f"milestone_check failed: {e}")
            return {"error": str(e)}

    async def _create_learning_plan(self, chat_id: str, topic: str, milestones: list, subject: str = "General") -> Dict:
        """Create a new milestone learning plan for the student."""
        import re
        import uuid
        from app.milestones.milestone_store import get_milestone_store, MilestonePlan, Milestone, MilestoneStatus

        def _strip_emojis(text: str) -> str:
            return re.sub(r'[^\x00-\x7F\u00C0-\u024F\u1E00-\u1EFF]+', '', text).strip()

        store = get_milestone_store()
        if store.get_plan_for_topic(chat_id, topic):
            return {"status": "already_exists", "topic": topic}

        ms = [
            Milestone(
                milestone_id=str(uuid.uuid4())[:8],
                title=_strip_emojis(m["title"]),
                description=_strip_emojis(m["description"]),
                order=i + 1,
                status=MilestoneStatus.AVAILABLE if i == 0 else MilestoneStatus.LOCKED,
            )
            for i, m in enumerate(milestones[:5])
        ]
        plan = MilestonePlan(
            plan_id=str(uuid.uuid4())[:12],
            chat_id=chat_id,
            subject=subject,
            topic=topic,
            milestones=ms,
        )
        store.save_plan(plan)
        return {"status": "created", "plan_id": plan.plan_id, "topic": topic}


# Singleton
_registry: Optional[ToolRegistry] = None

def get_tool_registry() -> ToolRegistry:
    global _registry
    if _registry is None:
        _registry = ToolRegistry()
    return _registry