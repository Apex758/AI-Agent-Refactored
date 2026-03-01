"""
Skills Loader — Loads custom skills from data/skills/ directory.

Each skill is a directory containing a SKILL.md that describes the skill
and optionally Python files that implement tool handlers.

Structure:
  data/skills/
    my-skill/
      SKILL.md          # Description, instructions, parameters
      handler.py        # Optional: Python implementation
"""
import os
import importlib.util
from pathlib import Path
from typing import List, Dict, Optional

from app.core.config import settings
from app.core.logging import logger


class Skill:
    """Represents a loaded skill."""

    def __init__(self, name: str, description: str, instructions: str, path: Path):
        self.name = name
        self.description = description
        self.instructions = instructions
        self.path = path
        self.handler = None


class SkillLoader:
    """Loads skills from the skills directory."""

    def __init__(self, skills_dir: Optional[str] = None):
        self.skills_dir = Path(skills_dir or "./data/skills")
        self.skills: Dict[str, Skill] = {}

    def load_all(self) -> List[Skill]:
        """Load all skills from the skills directory."""
        if not self.skills_dir.exists():
            self.skills_dir.mkdir(parents=True, exist_ok=True)
            return []

        for skill_dir in self.skills_dir.iterdir():
            if skill_dir.is_dir():
                skill = self._load_skill(skill_dir)
                if skill:
                    self.skills[skill.name] = skill
                    logger.info(f"Loaded skill: {skill.name}")

        return list(self.skills.values())

    def _load_skill(self, skill_dir: Path) -> Optional[Skill]:
        """Load a single skill from its directory."""
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            return None

        content = skill_md.read_text()

        # Parse frontmatter-style metadata
        name = skill_dir.name
        description = ""
        instructions = content

        for line in content.split("\n"):
            if line.startswith("# "):
                name = line[2:].strip()
            elif line.startswith("description:"):
                description = line.split(":", 1)[1].strip()

        if not description:
            # First non-header paragraph as description
            for line in content.split("\n"):
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and not stripped.startswith("---"):
                    description = stripped[:200]
                    break

        skill = Skill(
            name=name,
            description=description,
            instructions=instructions,
            path=skill_dir,
        )

        # Try to load Python handler
        handler_py = skill_dir / "handler.py"
        if handler_py.exists():
            try:
                spec = importlib.util.spec_from_file_location(f"skill_{name}", str(handler_py))
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                if hasattr(module, "execute"):
                    skill.handler = module.execute
                    logger.info(f"Loaded handler for skill: {name}")
            except Exception as e:
                logger.warning(f"Failed to load handler for {name}: {e}")

        return skill

    def get_skill_context(self) -> str:
        """Get combined skill instructions for the system prompt."""
        if not self.skills:
            return ""

        parts = ["\n--- LOADED SKILLS ---"]
        for skill in self.skills.values():
            parts.append(f"\n### {skill.name}\n{skill.instructions[:500]}")
        parts.append("\n--- END SKILLS ---\n")
        return "\n".join(parts)

    def register_skill_tools(self, tool_registry):
        """Register skill handlers as tools."""
        from app.tools.registry import Tool

        for skill in self.skills.values():
            if skill.handler:
                tool_registry.register(Tool(
                    name=f"skill_{skill.name}",
                    description=skill.description,
                    parameters={"type": "object", "properties": {
                        "input": {"type": "string", "description": "Input for the skill"},
                    }},
                    handler=skill.handler,
                ))
