"""AI Agent — Main entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from app.core.config import settings
from app.core.logging import logger
from app.api.routes import router as api_router
from app.api.chats import router as chats_router
from app.api.documents import router as documents_router
from app.channels.whatsapp import router as whatsapp_router, is_enabled as whatsapp_enabled
from app.skills.loader import SkillLoader


def create_app() -> FastAPI:
    app = FastAPI(title=f"{settings.agent_name} — AI Agent", version="1.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix="/api", tags=["agent"])
    app.include_router(chats_router, prefix="/api/chats", tags=["chats"])
    app.include_router(documents_router, prefix="/api/documents", tags=["documents"])

    if whatsapp_enabled():
        app.include_router(whatsapp_router, prefix="/api/whatsapp", tags=["whatsapp"])

    skill_loader = SkillLoader()
    skills = skill_loader.load_all()
    if skills:
        from app.tools.registry import get_tool_registry
        skill_loader.register_skill_tools(get_tool_registry())

    frontend_dir = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
    if os.path.exists(frontend_dir):
        app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

        @app.get("/")
        async def serve_frontend():
            return FileResponse(os.path.join(frontend_dir, "index.html"))
    else:
        @app.get("/")
        async def root():
            return {"agent": settings.agent_name, "status": "running"}

    @app.on_event("startup")
    async def startup():
        logger.info(f"🤖 {settings.agent_name} starting...")
        logger.info(f"   LLM: {settings.llm_provider} / {settings.llm_model}")
        logger.info(f"   Memory: {settings.memory_workspace}")

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=settings.debug)