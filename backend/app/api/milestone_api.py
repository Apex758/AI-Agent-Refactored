"""
Milestone API — create, fetch, update, and check milestone plans.
"""
import uuid
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from app.milestones.milestone_store import (
    MilestonePlan, Milestone, MilestoneStatus,
    get_milestone_store,
)
from app.core.llm import get_llm
from app.core.logging import logger

router = APIRouter()


# ── Request / Response models ─────────────────────────────────────

class GeneratePlanRequest(BaseModel):
    chat_id: str
    topic: str
    subject: str = "General"
    grade_level: str = ""


class CheckRequest(BaseModel):
    correct: bool


class AdvanceRequest(BaseModel):
    plan_id: str


# ── Helpers ───────────────────────────────────────────────────────

async def _generate_milestones_via_llm(topic: str, subject: str, grade_level: str) -> List[dict]:
    """Ask the LLM to decompose a topic into 4–6 ordered milestones."""
    llm = get_llm()
    grade_hint = f" (grade level: {grade_level})" if grade_level else ""
    prompt = (
        f"Break the topic '{topic}' in {subject}{grade_hint} into 4 to 6 ordered learning milestones. "
        "Each milestone should be a single, assessable learning objective that builds on the previous one. "
        "Return ONLY a JSON array (no markdown, no preamble) with objects having these keys: "
        '"title" (short, ≤6 words), "description" (1 sentence explaining what the student will do/understand). '
        "Example: "
        '[{"title":"Understand place value","description":"Identify tens and ones in two-digit numbers."}]'
    )
    result = await llm.generate(
        messages=[{"role": "user", "content": prompt}],
        system_prompt="You generate structured milestone plans for educational topics. Return only valid JSON arrays.",
    )
    content = result.get("content", "[]")
    # Strip markdown fences if present
    if "```" in content:
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
    import json
    try:
        return json.loads(content.strip())
    except Exception:
        # Fallback to generic milestones
        return [
            {"title": "Introduction", "description": f"Understand the basics of {topic}."},
            {"title": "Core concepts", "description": f"Learn the key ideas in {topic}."},
            {"title": "Practice", "description": f"Apply {topic} to simple problems."},
            {"title": "Mastery", "description": f"Solve complex problems involving {topic}."},
        ]


# ── Endpoints ─────────────────────────────────────────────────────

@router.post("")
async def create_plan(req: GeneratePlanRequest):
    """Generate a milestone plan for a topic using the LLM, then save it."""
    store = get_milestone_store()

    # Re-use existing plan for same chat + topic
    existing = store.get_plan_for_topic(req.chat_id, req.topic)
    if existing:
        return existing.to_dict()

    raw = await _generate_milestones_via_llm(req.topic, req.subject, req.grade_level)

    milestones = []
    for i, m in enumerate(raw):
        status = MilestoneStatus.AVAILABLE if i == 0 else MilestoneStatus.LOCKED
        milestones.append(Milestone(
            milestone_id=str(uuid.uuid4())[:8],
            title=m.get("title", f"Step {i+1}"),
            description=m.get("description", ""),
            order=i + 1,
            status=status,
        ))

    plan = MilestonePlan(
        plan_id=str(uuid.uuid4())[:12],
        chat_id=req.chat_id,
        subject=req.subject,
        topic=req.topic,
        grade_level=req.grade_level,
        milestones=milestones,
    )
    store.save_plan(plan)
    logger.info(f"Created milestone plan {plan.plan_id} for topic '{req.topic}' in chat {req.chat_id}")
    return plan.to_dict()


@router.get("/chat/{chat_id}")
async def list_plans(chat_id: str):
    """List all milestone plans for a chat."""
    store = get_milestone_store()
    plans = store.list_plans_for_chat(chat_id)
    return {"plans": [p.to_dict() for p in plans]}


@router.get("/{plan_id}")
async def get_plan(plan_id: str):
    store = get_milestone_store()
    plan = store.get_plan(plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    return plan.to_dict()


@router.post("/{plan_id}/check")
async def record_check(plan_id: str, req: CheckRequest):
    """Record a check attempt on the current milestone."""
    store = get_milestone_store()
    plan = store.get_plan(plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")

    current = plan.current_milestone()
    if not current:
        return {"message": "All milestones mastered!", "plan": plan.to_dict()}

    current.status = MilestoneStatus.IN_PROGRESS
    current.record_check(req.correct)

    if current.check_mastery():
        plan.advance()

    store.save_plan(plan)
    return plan.to_dict()


@router.post("/{plan_id}/advance")
async def advance_plan(plan_id: str):
    """Manually advance to the next milestone (teacher override)."""
    store = get_milestone_store()
    plan = store.get_plan(plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    plan.advance()
    store.save_plan(plan)
    return plan.to_dict()


@router.delete("/{plan_id}")
async def delete_plan(plan_id: str):
    store = get_milestone_store()
    store.delete_plan(plan_id)
    return {"status": "deleted"}
