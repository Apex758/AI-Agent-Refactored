"""
Memory Manager — OpenClaw-style persistent memory.

Architecture:
  - Markdown files are the source of truth
  - MEMORY.md = global long-term facts
  - chats/{chat_id}.md = per-chat memory (summary + keywords + key facts)
  - memory/YYYY-MM-DD.md = daily conversation logs
  - SQLite for conversation history + chat metadata (no vectors)
  - ChromaDB for all vector search — persistent, real semantic search
"""
import json
import hashlib
import sqlite3
from datetime import datetime, date
from typing import List, Dict, Optional
from pathlib import Path

from app.core.config import settings
from app.core.logging import logger


def _get_chroma_ef():
    """
    Return the ChromaDB embedding function.
    Uses OpenAI if key is set, otherwise falls back to the built-in
    sentence-transformers model (runs locally, no API key needed).
    """
    if settings.openai_api_key:
        from chromadb.utils.embedding_functions import OpenAIEmbeddingFunction
        return OpenAIEmbeddingFunction(
            api_key=settings.openai_api_key,
            model_name="text-embedding-3-small",
        )
    else:
        from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
        return SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")


def _chunk_text(text: str, chunk_size: int = 400, overlap: int = 50) -> List[str]:
    """
    Split text into overlapping word-count chunks for better retrieval.
    400 words ~ 500 tokens. Overlap ensures context isn't lost at boundaries.
    """
    words = text.split()
    if len(words) <= chunk_size:
        return [text] if text.strip() else []
    chunks = []
    start = 0
    while start < len(words):
        chunk = " ".join(words[start:start + chunk_size])
        if chunk.strip():
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


class MemoryManager:
    def __init__(self, workspace: Optional[str] = None):
        self.workspace = Path(workspace or settings.memory_workspace)
        self.memory_dir = self.workspace / "memory"
        self.chats_dir = self.workspace / "chats"
        self.chroma_dir = self.workspace / "chroma"
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self.chats_dir.mkdir(parents=True, exist_ok=True)
        self.chroma_dir.mkdir(parents=True, exist_ok=True)

        self.memory_file = self.workspace / "MEMORY.md"
        self.db_path = self.workspace / ".memory_index.db"

        self._chroma_client = None
        self._collection = None

        self._init_db()
        self._init_chroma()
        self._ensure_memory_file()

    # ── ChromaDB Init ────────────────────────────────────────────────

    def _init_chroma(self):
        """Initialize persistent ChromaDB client and collection."""
        import chromadb
        self._chroma_client = chromadb.PersistentClient(path=str(self.chroma_dir))
        self._collection = self._chroma_client.get_or_create_collection(
            name="agent_memory",
            embedding_function=_get_chroma_ef(),
            metadata={"hnsw:space": "cosine"},
        )
        logger.info(f"ChromaDB ready — {self._collection.count()} documents indexed")

    # ── SQLite Init (conversations + chats metadata only) ────────────

    def _init_db(self):
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_conv_client ON conversations(client_id)")
        conn.commit()
        conn.close()

    # ── Global Memory (Markdown) ─────────────────────────────────────

    def _ensure_memory_file(self):
        if not self.memory_file.exists():
            self.memory_file.write_text(
                "# Agent Memory\n\n## User Profile\n\n## Key Decisions\n\n## Important Facts\n\n"
            )

    def get_memory_file(self) -> str:
        return self.memory_file.read_text() if self.memory_file.exists() else ""

    def update_memory_file(self, content: str):
        self.memory_file.write_text(content)
        self._index_file(str(self.memory_file))

    def append_to_memory(self, section: str, content: str):
        current = self.get_memory_file()
        marker = f"## {section}"
        if marker in current:
            parts = current.split(marker, 1)
            updated = parts[0] + marker + "\n\n" + content + "\n" + parts[1]
        else:
            updated = current + f"\n\n## {section}\n\n{content}\n"
        self.update_memory_file(updated)

    # ── Per-Chat Memory ──────────────────────────────────────────────

    def get_chat_memory(self, chat_id: str) -> str:
        path = self.chats_dir / f"{chat_id}.md"
        return path.read_text() if path.exists() else ""

    def _write_chat_memory(self, chat_id: str, content: str):
        path = self.chats_dir / f"{chat_id}.md"
        path.write_text(content)

    async def update_chat_memory(self, chat_id: str, user_msg: str, assistant_msg: str):
        """Regenerate this chat's memory file: summary + keywords + facts."""
        from app.core.llm import get_llm

        history = self.get_history(chat_id, limit=30)
        conversation_text = "\n".join(
            f"{h['role'].upper()}: {h['content'][:300]}" for h in history
        )
        if not conversation_text.strip():
            return

        llm = get_llm()
        prompt = (
            "Analyze this conversation and return JSON with these exact keys:\n"
            '{"summary": "2-3 sentence summary of what was discussed", '
            '"keywords": ["keyword1", "keyword2", ...up to 10], '
            '"key_facts": ["fact1", "fact2", ...important things said or decided]}\n\n'
            "Return ONLY valid JSON, nothing else.\n\n"
            f"Conversation:\n{conversation_text[:3000]}"
        )
        try:
            result = await llm.generate(
                messages=[{"role": "user", "content": prompt}],
                system_prompt="You extract structured memory from conversations. Return only valid JSON.",
            )
            content = result.get("content", "")
            if "{" in content:
                json_str = content[content.index("{"):content.rindex("}") + 1]
                data = json.loads(json_str)
                summary = data.get("summary", "")
                keywords = data.get("keywords", [])
                facts = data.get("key_facts", [])

                conn = sqlite3.connect(str(self.db_path))
                row = conn.execute("SELECT name FROM chats WHERE id = ?", (chat_id,)).fetchone()
                conn.close()
                chat_name = row[0] if row else chat_id

                md = f"# Chat Memory: {chat_name}\n\n"
                md += f"**Chat ID:** {chat_id}\n"
                md += f"**Last Updated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n"
                md += f"## Summary\n{summary}\n\n"
                md += f"## Keywords\n{', '.join(keywords)}\n\n"
                if facts:
                    md += "## Key Facts\n"
                    for f in facts:
                        md += f"- {f}\n"

                self._write_chat_memory(chat_id, md)

                # Index the summary into ChromaDB for cross-chat semantic search
                if summary:
                    await self._index_text(
                        summary,
                        source=f"chat_summary:{chat_id}",
                        metadata={"type": "chat_summary", "chat_id": chat_id, "chat_name": chat_name},
                    )
                logger.info(f"Updated memory for chat {chat_id}")
        except Exception as e:
            logger.warning(f"Chat memory update failed: {e}")

    def search_all_chats(self, query: str, limit: int = 5) -> List[Dict]:
        """
        Search all chat memory files.
        Tries ChromaDB semantic search on indexed summaries first,
        falls back to keyword scan of .md files.
        """
        try:
            count = self._collection.count()
            if count > 0:
                results = self._collection.query(
                    query_texts=[query],
                    n_results=min(limit, count),
                    where={"type": "chat_summary"},
                )
                chroma_hits = {}
                if results and results["documents"] and results["documents"][0]:
                    for doc, meta, dist in zip(
                        results["documents"][0],
                        results["metadatas"][0],
                        results["distances"][0],
                    ):
                        cid = meta.get("chat_id", "")
                        if cid and cid not in chroma_hits:
                            mem = self.get_chat_memory(cid)
                            keywords = ""
                            if "## Keywords" in mem:
                                keywords = mem.split("## Keywords")[1].split("##")[0].strip()[:200]
                            chroma_hits[cid] = {
                                "chat_id": cid,
                                "chat_name": meta.get("chat_name", cid),
                                "score": round(1 - dist, 3),
                                "summary": doc[:300],
                                "keywords": keywords,
                            }
                if chroma_hits:
                    return sorted(chroma_hits.values(), key=lambda x: x["score"], reverse=True)[:limit]
        except Exception as e:
            logger.warning(f"ChromaDB chat search failed, falling back to keyword: {e}")

        # Keyword fallback
        query_lower = query.lower()
        results = []
        for mem_file in self.chats_dir.glob("*.md"):
            content = mem_file.read_text()
            score = sum(1 for word in query_lower.split() if word in content.lower())
            if score == 0:
                continue
            chat_id = mem_file.stem
            name_line = [l for l in content.split("\n") if l.startswith("# Chat Memory:")]
            chat_name = name_line[0].replace("# Chat Memory:", "").strip() if name_line else chat_id
            summary = content.split("## Summary")[1].split("##")[0].strip()[:300] if "## Summary" in content else ""
            keywords = content.split("## Keywords")[1].split("##")[0].strip()[:200] if "## Keywords" in content else ""
            results.append({"chat_id": chat_id, "chat_name": chat_name, "score": score, "summary": summary, "keywords": keywords})
        return sorted(results, key=lambda x: x["score"], reverse=True)[:limit]

    # ── Daily Logs ───────────────────────────────────────────────────

    def get_daily_log(self, log_date: Optional[date] = None) -> str:
        d = log_date or date.today()
        path = self.memory_dir / f"{d.isoformat()}.md"
        return path.read_text() if path.exists() else ""

    def append_daily_log(self, entry: str, log_date: Optional[date] = None):
        d = log_date or date.today()
        path = self.memory_dir / f"{d.isoformat()}.md"
        if not path.exists():
            path.write_text(f"# Daily Log — {d.isoformat()}\n\n")
        timestamp = datetime.now().strftime("%H:%M")
        with open(path, "a") as f:
            f.write(f"\n### {timestamp}\n\n{entry}\n")
        self._index_file(str(path))

    # ── Auto-Capture ─────────────────────────────────────────────────

    async def auto_capture(self, user_msg: str, assistant_msg: str, client_id: str = "default"):
        if not settings.memory_auto_capture:
            return

        entry = f"**User ({client_id}):** {user_msg[:500]}\n\n**Assistant:** {assistant_msg[:500]}"
        self.append_daily_log(entry)

        try:
            await self._extract_and_store_facts(user_msg, assistant_msg)
        except Exception as e:
            logger.warning(f"Fact extraction failed: {e}")

        try:
            await self.update_chat_memory(client_id, user_msg, assistant_msg)
        except Exception as e:
            logger.warning(f"Chat memory update failed: {e}")

        try:
            await self._auto_name_chat(client_id, user_msg, assistant_msg)
        except Exception as e:
            logger.warning(f"Chat auto-naming failed: {e}")

    async def _extract_and_store_facts(self, user_msg: str, assistant_msg: str):
        from app.core.llm import get_llm
        llm = get_llm()
        prompt = (
            "Extract personal facts about the USER ONLY from this exchange — things like their preferences, "
            "habits, goals, opinions, or personal details they revealed. "
            "Do NOT include general knowledge, definitions, or facts about the world. "
            "Only include what the user personally said, likes, dislikes, wants, or did.\n\n"
            'Return JSON: {"facts": ["User likes X", "User wants to..."]} or {"facts": []} if nothing personal.\n\n'
            f"User: {user_msg[:300]}\nAssistant: {assistant_msg[:300]}"
        )
        result = await llm.generate(
            messages=[{"role": "user", "content": prompt}],
            system_prompt="Extract personal user facts only. Return only valid JSON.",
        )
        content = result.get("content", "")
        try:
            if "{" in content:
                json_str = content[content.index("{"):content.rindex("}") + 1]
                data = json.loads(json_str)
                for fact in data.get("facts", []):
                    if fact.strip():
                        self.append_to_memory("Important Facts", f"- {fact.strip()}")
                        await self._index_text(
                            fact.strip(),
                            source="extracted_fact",
                            metadata={"type": "user_fact"},
                        )
        except (json.JSONDecodeError, ValueError):
            pass

    async def _auto_name_chat(self, chat_id: str, user_msg: str, assistant_msg: str):
        conn = sqlite3.connect(str(self.db_path))
        row = conn.execute("SELECT name FROM chats WHERE id = ?", (chat_id,)).fetchone()
        conn.close()
        if not row or not row[0].startswith("Chat "):
            return
        history = self.get_history(chat_id, limit=4)
        if len(history) > 2:
            return
        from app.core.llm import get_llm
        llm = get_llm()
        prompt = (
            "Give this conversation a short title (3-5 words max). "
            "It should describe the topic, like a chapter title. "
            "No quotes, no punctuation at the end. Just the title.\n\n"
            f"User: {user_msg[:200]}\nAssistant: {assistant_msg[:200]}"
        )
        result = await llm.generate(
            messages=[{"role": "user", "content": prompt}],
            system_prompt="You generate short, descriptive chat titles. Respond with only the title, nothing else.",
        )
        name = result.get("content", "").strip().strip('"').strip("'")[:60]
        if name:
            conn = sqlite3.connect(str(self.db_path))
            conn.execute("UPDATE chats SET name = ? WHERE id = ?", (name, chat_id))
            conn.commit()
            conn.close()
            logger.info(f"Named chat {chat_id}: {name}")

    # ── Auto-Recall ──────────────────────────────────────────────────

    async def auto_recall(self, query: str, top_k: int = 5) -> str:
        if not settings.memory_auto_recall:
            return ""

        parts = []
        mem = self.get_memory_file()
        if mem:
            parts.append(f"## Global Memory\n{mem[:2000]}")

        today_log = self.get_daily_log()
        if today_log:
            parts.append(f"## Today's Context\n{today_log[:1500]}")

        search_results = await self.search(query, top_k=top_k)
        if search_results:
            snippets = "\n".join([f"- {r['text'][:200]}" for r in search_results])
            parts.append(f"## Relevant Memories\n{snippets}")

        return "\n\n".join(parts) if parts else ""

    # ── ChromaDB Vector Search ───────────────────────────────────────

    async def _index_text(
        self,
        text: str,
        source: str,
        metadata: Optional[Dict] = None,
    ):
        """
        Add a single text snippet to ChromaDB.
        ChromaDB handles embedding generation via the configured embedding function.
        Uses upsert so re-indexing the same text is idempotent.
        """
        if not text.strip():
            return

        doc_id = hashlib.sha256(text.encode()).hexdigest()[:32]
        meta = {"source": source, **(metadata or {})}

        try:
            self._collection.upsert(
                ids=[doc_id],
                documents=[text],
                metadatas=[meta],
            )
        except Exception as e:
            logger.warning(f"ChromaDB index failed: {e}")

    def _index_file(self, filepath: str):
        """
        Chunk a file into overlapping windows and index each chunk into ChromaDB.
        Proper RAG chunking: 400 words per chunk, 50-word overlap.
        """
        try:
            content = open(filepath).read()
        except Exception:
            return

        chunks = _chunk_text(content, chunk_size=400, overlap=50)
        import asyncio
        for i, chunk in enumerate(chunks):
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(
                        self._index_text(chunk, source=filepath, metadata={"type": "file_chunk", "chunk": i})
                    )
                else:
                    loop.run_until_complete(
                        self._index_text(chunk, source=filepath, metadata={"type": "file_chunk", "chunk": i})
                    )
            except RuntimeError:
                doc_id = hashlib.sha256(chunk.encode()).hexdigest()[:32]
                try:
                    self._collection.upsert(
                        ids=[doc_id],
                        documents=[chunk],
                        metadatas=[{"source": filepath, "type": "file_chunk", "chunk": i}],
                    )
                except Exception as e:
                    logger.warning(f"Sync index failed: {e}")

    async def search(self, query: str, top_k: int = 5) -> List[Dict]:
        """
        Semantic search using ChromaDB.
        ChromaDB returns results sorted by distance (closest first).
        We convert cosine distance → similarity score (1 - distance).
        """
        count = self._collection.count()
        if count == 0:
            return []

        try:
            results = self._collection.query(
                query_texts=[query],
                n_results=min(top_k, count),
            )
        except Exception as e:
            logger.warning(f"ChromaDB search failed: {e}")
            return []

        if not results or not results["documents"] or not results["documents"][0]:
            return []

        output = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            output.append({
                "text": doc,
                "source": meta.get("source", ""),
                "score": round(1 - dist, 3),
                "metadata": meta,
            })

        return output  # ChromaDB already returns closest-first

    # ── Conversation History (SQLite) ────────────────────────────────

    def save_message(self, client_id: str, role: str, content: str):
        conn = sqlite3.connect(str(self.db_path))
        conn.execute(
            "INSERT INTO conversations (client_id, role, content) VALUES (?, ?, ?)",
            (client_id, role, content),
        )
        conn.commit()
        conn.close()

    def get_history(self, client_id: str, limit: int = 20) -> List[Dict]:
        conn = sqlite3.connect(str(self.db_path))
        rows = conn.execute(
            "SELECT role, content, created_at FROM conversations WHERE client_id = ? ORDER BY id DESC LIMIT ?",
            (client_id, limit),
        ).fetchall()
        conn.close()
        return [{"role": r[0], "content": r[1], "timestamp": r[2]} for r in reversed(rows)]

    def clear_history(self, client_id: str):
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("DELETE FROM conversations WHERE client_id = ?", (client_id,))
        conn.commit()
        conn.close()

    # ── Memory Tools (exposed to agent) ─────────────────────────────

    async def memory_store(self, content: str, tags: str = "") -> str:
        self.append_to_memory("Important Facts", f"- {content}")
        await self._index_text(content, source="explicit_store", metadata={"type": "user_fact"})
        return f"Stored: {content[:100]}"

    async def memory_search_tool(self, query: str) -> str:
        results = await self.search(query, top_k=5)
        if not results:
            return "No relevant memories found."
        return "\n".join([f"[{r['score']:.2f}] {r['text'][:200]}" for r in results])

    async def memory_get(self, file_path: str = "MEMORY.md") -> str:
        if file_path == "MEMORY.md":
            return self.get_memory_file()
        full_path = self.memory_dir / file_path
        return full_path.read_text() if full_path.exists() else f"File not found: {file_path}"


# Singleton
_memory: Optional[MemoryManager] = None

def get_memory() -> MemoryManager:
    global _memory
    if _memory is None:
        _memory = MemoryManager()
    return _memory