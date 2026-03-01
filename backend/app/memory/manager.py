"""
Memory Manager — OpenClaw-style persistent memory.

Architecture:
  - Markdown files are the source of truth (human-readable, editable, git-friendly)
  - MEMORY.md = curated long-term facts (preferences, identity, key decisions)
  - memory/YYYY-MM-DD.md = daily conversation logs (append-only)
  - SQLite + numpy for vector similarity search over all memory files
  - Auto-capture: after every assistant turn, extract & store important info
  - Auto-recall: before every LLM call, inject relevant memories
"""
import os
import json
import hashlib
import sqlite3
import numpy as np
from datetime import datetime, date
from typing import List, Dict, Optional, Tuple
from pathlib import Path

from app.core.config import settings
from app.core.logging import logger


class MemoryManager:
    """Manages persistent memory using Markdown files + vector index."""

    def __init__(self, workspace: Optional[str] = None):
        self.workspace = Path(workspace or settings.memory_workspace)
        self.memory_dir = self.workspace / "memory"
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        self.memory_file = self.workspace / "MEMORY.md"
        self.db_path = self.workspace / ".memory_index.db"
        self._embedder = None
        self._init_db()
        self._ensure_memory_file()

    # ── Markdown Operations ──────────────────────────────────────────

    def _ensure_memory_file(self):
        """Create MEMORY.md if it doesn't exist."""
        if not self.memory_file.exists():
            self.memory_file.write_text(
                "# Agent Memory\n\n"
                "## User Profile\n\n"
                "<!-- Add user facts, preferences, identity here -->\n\n"
                "## Key Decisions\n\n"
                "## Important Facts\n\n"
            )

    def get_memory_file(self) -> str:
        """Read curated MEMORY.md."""
        if self.memory_file.exists():
            return self.memory_file.read_text()
        return ""

    def update_memory_file(self, content: str):
        """Overwrite MEMORY.md (the agent curates this)."""
        self.memory_file.write_text(content)
        self._index_file(str(self.memory_file))

    def append_to_memory(self, section: str, content: str):
        """Append content under a section heading in MEMORY.md."""
        current = self.get_memory_file()
        marker = f"## {section}"
        if marker in current:
            # Insert after the section header
            parts = current.split(marker, 1)
            updated = parts[0] + marker + "\n\n" + content + "\n" + parts[1]
        else:
            updated = current + f"\n\n## {section}\n\n{content}\n"
        self.update_memory_file(updated)

    def get_daily_log(self, log_date: Optional[date] = None) -> str:
        """Read a daily log file."""
        d = log_date or date.today()
        path = self.memory_dir / f"{d.isoformat()}.md"
        if path.exists():
            return path.read_text()
        return ""

    def append_daily_log(self, entry: str, log_date: Optional[date] = None):
        """Append to today's daily log."""
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
        """
        After every turn, capture important information.
        Stores conversation snippet in daily log.
        Extracts key facts for MEMORY.md via LLM (if enabled).
        """
        if not settings.memory_auto_capture:
            return

        # Always log to daily file
        entry = f"**User ({client_id}):** {user_msg[:500]}\n\n**Assistant:** {assistant_msg[:500]}"
        self.append_daily_log(entry)

        # Extract key facts using LLM (async, non-blocking)
        try:
            await self._extract_and_store_facts(user_msg, assistant_msg)
        except Exception as e:
            logger.warning(f"Memory extraction failed: {e}")

    async def _extract_and_store_facts(self, user_msg: str, assistant_msg: str):
        """Use LLM to extract storable facts from conversation."""
        from app.core.llm import get_llm

        llm = get_llm()
        prompt = (
            "Extract any important facts, preferences, or decisions from this exchange. "
            "Return JSON: {\"facts\": [\"fact1\", \"fact2\"]} or {\"facts\": []} if nothing important.\n\n"
            f"User: {user_msg[:300]}\nAssistant: {assistant_msg[:300]}"
        )

        result = await llm.generate(
            messages=[{"role": "user", "content": prompt}],
            system_prompt="You extract key facts from conversations. Return only valid JSON.",
        )

        content = result.get("content", "")
        try:
            # Try to parse JSON from response
            if "{" in content:
                json_str = content[content.index("{"):content.rindex("}") + 1]
                data = json.loads(json_str)
                facts = data.get("facts", [])
                for fact in facts:
                    if fact.strip():
                        self.append_to_memory("Important Facts", f"- {fact.strip()}")
                        await self._index_text(fact.strip(), "extracted_fact")
        except (json.JSONDecodeError, ValueError):
            pass

    # ── Auto-Recall ──────────────────────────────────────────────────

    async def auto_recall(self, query: str, top_k: int = 5) -> str:
        """
        Before every LLM call, retrieve relevant memories.
        Combines: MEMORY.md header + today's log + semantic search results.
        """
        if not settings.memory_auto_recall:
            return ""

        parts = []

        # 1. Core identity from MEMORY.md (first 2000 chars)
        mem = self.get_memory_file()
        if mem:
            parts.append(f"## Curated Memory\n{mem[:2000]}")

        # 2. Today + yesterday's log
        today_log = self.get_daily_log()
        if today_log:
            parts.append(f"## Today's Context\n{today_log[:1500]}")

        from datetime import timedelta
        yesterday_log = self.get_daily_log(date.today() - timedelta(days=1))
        if yesterday_log:
            parts.append(f"## Yesterday's Context\n{yesterday_log[:1000]}")

        # 3. Semantic search for query-relevant memories
        search_results = await self.search(query, top_k=top_k)
        if search_results:
            snippets = "\n".join([f"- {r['text'][:200]}" for r in search_results])
            parts.append(f"## Relevant Memories\n{snippets}")

        return "\n\n".join(parts) if parts else ""

    # ── Vector Search ────────────────────────────────────────────────

    def _init_db(self):
        """Initialize SQLite database for vector index."""
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("""
            CREATE TABLE IF NOT EXISTS memory_vectors (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                source TEXT NOT NULL,
                embedding BLOB,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                hash TEXT UNIQUE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_conv_client ON conversations(client_id)")
        conn.commit()
        conn.close()

    async def _get_embedding(self, text: str) -> List[float]:
        """Generate embedding for text."""
        if settings.embedding_provider == "openai":
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=settings.openai_api_key)
            response = await client.embeddings.create(
                model="text-embedding-3-small",
                input=text[:8000],
            )
            return response.data[0].embedding
        else:
            # Fallback: simple TF-IDF-like hash embedding
            return self._simple_embedding(text)

    def _simple_embedding(self, text: str, dim: int = 256) -> List[float]:
        """Fallback embedding using character n-gram hashing."""
        vec = np.zeros(dim)
        words = text.lower().split()
        for w in words:
            h = int(hashlib.md5(w.encode()).hexdigest(), 16)
            idx = h % dim
            vec[idx] += 1.0
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec.tolist()

    async def _index_text(self, text: str, source: str):
        """Index a text snippet into the vector store."""
        text_hash = hashlib.sha256(text.encode()).hexdigest()[:32]

        conn = sqlite3.connect(str(self.db_path))
        existing = conn.execute("SELECT id FROM memory_vectors WHERE hash = ?", (text_hash,)).fetchone()
        if existing:
            conn.close()
            return

        try:
            embedding = await self._get_embedding(text)
            emb_bytes = np.array(embedding, dtype=np.float32).tobytes()

            conn.execute(
                "INSERT OR IGNORE INTO memory_vectors (id, text, source, embedding, hash) VALUES (?, ?, ?, ?, ?)",
                (text_hash[:16], text, source, emb_bytes, text_hash),
            )
            conn.commit()
        except Exception as e:
            logger.warning(f"Failed to index text: {e}")
        finally:
            conn.close()

    def _index_file(self, filepath: str):
        """Index a markdown file (splits into chunks)."""
        try:
            with open(filepath, "r") as f:
                content = f.read()
        except Exception:
            return

        # Split by sections or paragraphs
        chunks = []
        current = ""
        for line in content.split("\n"):
            if line.startswith("###") and current.strip():
                chunks.append(current.strip())
                current = line + "\n"
            else:
                current += line + "\n"
        if current.strip():
            chunks.append(current.strip())

        # Index chunks synchronously (called from sync context)
        import asyncio
        for chunk in chunks:
            if len(chunk) > 20:  # Skip tiny chunks
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.create_task(self._index_text(chunk, filepath))
                    else:
                        loop.run_until_complete(self._index_text(chunk, filepath))
                except RuntimeError:
                    # No event loop, use simple embedding
                    text_hash = hashlib.sha256(chunk.encode()).hexdigest()[:32]
                    emb = self._simple_embedding(chunk)
                    emb_bytes = np.array(emb, dtype=np.float32).tobytes()
                    conn = sqlite3.connect(str(self.db_path))
                    conn.execute(
                        "INSERT OR IGNORE INTO memory_vectors (id, text, source, embedding, hash) VALUES (?, ?, ?, ?, ?)",
                        (text_hash[:16], chunk, filepath, emb_bytes, text_hash),
                    )
                    conn.commit()
                    conn.close()

    async def search(self, query: str, top_k: int = 5) -> List[Dict]:
        """Semantic search across all indexed memory."""
        query_embedding = await self._get_embedding(query)
        query_vec = np.array(query_embedding, dtype=np.float32)

        conn = sqlite3.connect(str(self.db_path))
        rows = conn.execute("SELECT id, text, source, embedding FROM memory_vectors WHERE embedding IS NOT NULL").fetchall()
        conn.close()

        if not rows:
            return []

        results = []
        for row_id, text, source, emb_bytes in rows:
            stored_vec = np.frombuffer(emb_bytes, dtype=np.float32)
            if len(stored_vec) != len(query_vec):
                continue
            # Cosine similarity
            dot = np.dot(query_vec, stored_vec)
            norm_q = np.linalg.norm(query_vec)
            norm_s = np.linalg.norm(stored_vec)
            if norm_q > 0 and norm_s > 0:
                score = dot / (norm_q * norm_s)
            else:
                score = 0
            results.append({"id": row_id, "text": text, "source": source, "score": float(score)})

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    # ── Conversation History (Short-term) ────────────────────────────

    def save_message(self, client_id: str, role: str, content: str):
        """Save a message to conversation history."""
        conn = sqlite3.connect(str(self.db_path))
        conn.execute(
            "INSERT INTO conversations (client_id, role, content) VALUES (?, ?, ?)",
            (client_id, role, content),
        )
        conn.commit()
        conn.close()

    def get_history(self, client_id: str, limit: int = 20) -> List[Dict]:
        """Get recent conversation history."""
        conn = sqlite3.connect(str(self.db_path))
        rows = conn.execute(
            "SELECT role, content, created_at FROM conversations WHERE client_id = ? ORDER BY id DESC LIMIT ?",
            (client_id, limit),
        ).fetchall()
        conn.close()
        return [{"role": r[0], "content": r[1], "timestamp": r[2]} for r in reversed(rows)]

    def clear_history(self, client_id: str):
        """Clear conversation history for a client."""
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("DELETE FROM conversations WHERE client_id = ?", (client_id,))
        conn.commit()
        conn.close()

    # ── Memory Tools (exposed to the agent) ──────────────────────────

    async def memory_store(self, content: str, tags: str = "") -> str:
        """Tool: Store a memory explicitly."""
        self.append_to_memory("Important Facts", f"- {content}")
        await self._index_text(content, "explicit_store")
        return f"Stored: {content[:100]}"

    async def memory_search_tool(self, query: str) -> str:
        """Tool: Search memory semantically."""
        results = await self.search(query, top_k=5)
        if not results:
            return "No relevant memories found."
        return "\n".join([f"[{r['score']:.2f}] {r['text'][:200]}" for r in results])

    async def memory_get(self, file_path: str = "MEMORY.md") -> str:
        """Tool: Read a specific memory file."""
        if file_path == "MEMORY.md":
            return self.get_memory_file()
        full_path = self.memory_dir / file_path
        if full_path.exists():
            return full_path.read_text()
        return f"File not found: {file_path}"


# Singleton
_memory: Optional[MemoryManager] = None

def get_memory() -> MemoryManager:
    global _memory
    if _memory is None:
        _memory = MemoryManager()
    return _memory
