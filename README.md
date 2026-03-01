# AI Agent (OpenClaw-style)

Personal AI agent with persistent memory, tool execution, and optional WhatsApp channel.

## Quick Start

```bash
cd backend
cp .env.example .env  # Add your API keys
pip install -r requirements.txt
python -m app.main
```

Web UI: `http://localhost:8000` | WhatsApp: Configure webhook in .env

## Architecture

- **Gateway**: Routes messages between channels → LLM → tools → response
- **Memory**: Markdown files + SQLite vector search, auto-captured every turn
- **Channels**: Web (always on), WhatsApp (optional via Twilio)
- **Skills**: Drop SKILL.md files in `data/skills/` to extend capabilities
- **Tools**: Web search, filesystem, scraper, custom tools via registry
