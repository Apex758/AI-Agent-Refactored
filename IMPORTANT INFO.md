**Personal use:** SQLite is fine. No Redis needed — you're one user, one process, no concurrency problems.

**Multi-user (Claude-style):** Whole stack changes. The five things you'd need to swap:

- **SQLite → PostgreSQL** — handles concurrent writes
- **Python dict → Redis** — shared WebSocket/session state across workers
- **numpy search → pgvector** — scales across thousands of users' memories
- **client_id string → JWT auth** — right now anyone can impersonate any user
- **await in request cycle → Celery** — memory capture/naming currently blocks the response

The core logic (`Gateway`, `MemoryManager`, tools) stays the same. The biggest rewrite is `manager.py` to swap the data layer, plus adding auth middleware. Everything else is config.