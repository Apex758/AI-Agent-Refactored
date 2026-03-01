# AI Agent

An intelligent AI agent with WebSocket-based real-time communication, memory management, and tool execution capabilities.

## Features

- Real-time chat via WebSocket
- Short-term and long-term memory management
- Tool registry with policy enforcement
- Retrieval-augmented generation (RAG)
- Streaming responses
- Modern React frontend with Next.js

## Tech Stack

### Backend

- FastAPI
- WebSocket support
- ChromaDB for vector storage
- SQLite for persistence
- LangChain for LLM integration

### Frontend

- Next.js 14
- TypeScript
- Tailwind CSS
- Zustand for state management

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- OpenAI API key

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Set environment variables
export OPENAI_API_KEY=your_api_key_here

# Run the server
uvicorn app.main:app --reload
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Architecture

- **Agent Orchestrator**: Coordinates tool execution and response generation
- **Memory System**: Manages short-term (conversation) and long-term (persistent) memory
- **Tool Registry**: Manages available tools with policy enforcement
- **Retrieval System**: Embeds and retrieves relevant context for RAG

## License

MIT
