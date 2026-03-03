"""
Visual Planner — LLM produces a structured visual plan BEFORE writing the explanation.

The plan is sent directly to the frontend, where TLDraw renders it as native shapes.
No SVG rendering happens on the backend.

Pipeline:
  1. User asks a learning question
  2. Planner asks LLM for structured JSON (diagram type, labels, connections)
  3. Raw plan sent to frontend via WebSocket
  4. Frontend DiagramBuilder creates TLDraw shapes (geo, arrows, text)
  5. Plan context injected into system prompt so LLM references figures correctly
  6. LLM writes explanation that matches the diagrams
"""
import json
from typing import List, Dict, Optional
from dataclasses import dataclass, field, asdict

from app.core.llm import get_llm
from app.core.logging import logger


@dataclass
class VisualSpec:
    """Spec for a single diagram the frontend will build with TLDraw."""
    visual_id: str          # "fig-1"
    visual_type: str        # diagram_cycle | diagram_flow | diagram_labeled | chart_bar | comparison
    title: str              # "The Water Cycle"
    labels: List[str]       # ["Evaporation", "Condensation", ...]
    connections: List[Dict] # [{"from": "Evaporation", "to": "Condensation"}]
    purpose: str            # "Show the cyclical process"
    complexity: str = "simple"
    colors: Dict[str, str] = field(default_factory=dict)  # label -> TLDraw color name


@dataclass
class VisualPlan:
    """Complete visual plan for a lesson. Sent to frontend as JSON."""
    topic: str
    lesson_outline: str
    key_terms: List[str]
    visuals: List[VisualSpec]
    explanation_guidance: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "VisualPlan":
        visuals = [VisualSpec(**v) for v in d.get("visuals", [])]
        return cls(
            topic=d.get("topic", ""),
            lesson_outline=d.get("lesson_outline", ""),
            key_terms=d.get("key_terms", []),
            visuals=visuals,
            explanation_guidance=d.get("explanation_guidance", ""),
        )

    def to_system_context(self) -> str:
        """Build system prompt context so the LLM knows what figures exist."""
        if not self.visuals:
            return ""

        parts = ["\n--- VISUAL FIGURES (already rendered on the whiteboard) ---"]
        for i, spec in enumerate(self.visuals):
            fig = i + 1
            parts.append(
                f"\nFigure {fig} ({spec.visual_id}): {spec.title}"
                f"\n  Type: {spec.visual_type}"
                f"\n  Shows: {', '.join(spec.labels)}"
                f"\n  Purpose: {spec.purpose}"
            )
        parts.append("\n--- END FIGURES ---")

        if self.explanation_guidance:
            parts.append(f"\n{self.explanation_guidance}")

        parts.append(
            "\nReference each figure by number (Figure 1, Figure 2) in your explanation."
            "\nThe diagrams are ALREADY visible to the student. Do NOT describe what they look like."
            "\nInstead, say things like: 'As you can see in Figure 1, evaporation occurs when...'"
        )
        return "\n".join(parts)


class VisualPlanner:
    """Asks the LLM for a structured visual plan given a user question."""

    PLAN_PROMPT = """You are a visual lesson planner for an educational whiteboard app.
Given a learning question, output a JSON plan describing 1-3 diagrams to draw.

The frontend will render these as native shapes (circles, rectangles, arrows).
You do NOT generate images. You describe the structure.

Rules:
- 1 to 3 visuals maximum. Prefer 1 high-quality diagram over many.
- Pick the BEST visual_type:
  * "diagram_cycle" - circular process, 3-8 nodes with arrows between them
  * "diagram_flow" - linear steps top-to-bottom with arrows
  * "diagram_labeled" - central concept with labeled parts radiating outward
  * "chart_bar" - bar chart comparing quantities (use connections with "value" key)
  * "comparison" - two-column side by side (first half = left, second half = right)
- Labels: SHORT, 1-4 words each, max 8 labels per diagram
- Connections: define relationships between labels
  For cycles/flows: [{"from": "A", "to": "B"}]
  For charts: [{"from": "Label", "value": 42}]
- Colors: optional, use TLDraw color names: blue, green, yellow, red, violet, orange, light-blue, light-green, light-red, light-violet, grey, black
- explanation_guidance: tell the explanation-writing AI how to reference the figures

Return ONLY valid JSON (no markdown fences, no preamble):
{
  "topic": "short topic name",
  "lesson_outline": "2-3 sentence summary",
  "key_terms": ["term1", "term2"],
  "visuals": [
    {
      "visual_id": "fig-1",
      "visual_type": "diagram_cycle",
      "title": "The Water Cycle",
      "labels": ["Evaporation", "Condensation", "Precipitation", "Collection"],
      "connections": [
        {"from": "Evaporation", "to": "Condensation"},
        {"from": "Condensation", "to": "Precipitation"},
        {"from": "Precipitation", "to": "Collection"},
        {"from": "Collection", "to": "Evaporation"}
      ],
      "purpose": "Overview of the complete water cycle",
      "complexity": "simple",
      "colors": {"Evaporation": "blue", "Condensation": "violet"}
    }
  ],
  "explanation_guidance": "Walk through Figure 1 clockwise, starting from Evaporation."
}"""

    async def plan(self, user_message: str, context: str = "") -> Optional[VisualPlan]:
        """Generate a visual plan for the given learning question."""
        llm = get_llm()
        user_prompt = f"Student question: {user_message[:500]}"
        if context:
            user_prompt += f"\n\nAdditional context: {context[:500]}"

        try:
            result = await llm.generate(
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=self.PLAN_PROMPT,
            )
            content = result.get("content", "")

            # Strip markdown fences
            if "```" in content:
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()

            if "{" not in content:
                logger.warning("[visual-planner] No JSON in response")
                return None

            json_str = content[content.index("{"):content.rindex("}") + 1]
            data = json.loads(json_str)
            plan = VisualPlan.from_dict(data)

            if not plan.visuals:
                logger.warning("[visual-planner] Plan has no visuals")
                return None
            plan.visuals = plan.visuals[:3]

            logger.info(f"[visual-planner] {plan.topic}: {len(plan.visuals)} diagram(s) "
                        f"({', '.join(v.visual_type for v in plan.visuals)})")
            return plan

        except Exception as e:
            logger.warning(f"[visual-planner] Failed: {e}")
            return None


# Singleton
_planner: Optional[VisualPlanner] = None

def get_visual_planner() -> VisualPlanner:
    global _planner
    if _planner is None:
        _planner = VisualPlanner()
    return _planner
