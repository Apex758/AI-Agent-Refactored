"""
Agent Gateway — Central orchestrator.

Flow:
  1. Channel receives message → Gateway.process()
  2. Memory auto-recall (inject relevant context)
  3. Document RAG search (inject relevant doc chunks with citations)
  4. Build prompt with personality + memory + doc context + tools
  5. LLM generates response (may call tools)
  6. Execute tool calls, feed results back
  7. Memory auto-capture
  8. Return response + citations to channel
"""
import asyncio
import json
import os
import re
import uuid
from typing import Dict, List, Optional, AsyncGenerator, Tuple

from app.core.config import settings
from app.core.logging import logger
from app.core.llm import get_llm
from app.memory.manager import get_memory
from app.tools.registry import get_tool_registry
from app.milestones.milestone_store import (
    get_milestone_store,
    MilestonePlan,
    Milestone,
    MilestoneStatus,
)
from app.api.whiteboard_types import WhiteboardScene
from app.utils.text_cleaner import clean_for_tts, clean_for_whiteboard, clean_for_subtitle
from app.visuals.planner import get_visual_planner, VisualPlan


class Gateway:
    def __init__(self):
        self.llm = get_llm()
        self.memory = get_memory()
        self.tools = get_tool_registry()
        self._personality = None

    def get_personality(self) -> str:
        if self._personality is not None:
            return self._personality
        personality_path = settings.agent_personality
        for candidate in [personality_path, f"../{personality_path}", f"data/{personality_path}"]:
            if os.path.exists(candidate):
                try:
                    with open(candidate, encoding="utf-8") as f:
                        self._personality = f.read()
                except UnicodeDecodeError as e:
                    logger.warning(f"Failed to read personality file {candidate} as UTF-8: {e}")
                    with open(candidate, encoding="utf-8", errors="replace") as f:
                        self._personality = f.read()
                return self._personality
        self._personality = (
            f"You are {settings.agent_name}, a personal AI agent. "
            "You have persistent memory and can use tools. "
            "When you reference document content, mention the source filename naturally."
        )
        return self._personality

    async def _generate_visual_plan(self, message: str) -> Tuple[str, Optional[dict]]:
        """
        Visual-first pipeline: ask LLM what diagrams this lesson needs.
        Returns (visual_context_for_system_prompt, plan_dict_for_frontend).

        The plan dict is sent to the frontend via WebSocket so DiagramBuilder
        can create native TLDraw shapes. The context string is injected into
        the system prompt so the explanation-writing LLM knows what figures exist.
        """
        planner = get_visual_planner()

        try:
            plan = await planner.plan(message)
            if not plan or not plan.visuals:
                return "", None

            visual_context = plan.to_system_context()
            plan_dict = plan.to_dict()

            logger.info(f"[visual-plan] Generated {len(plan.visuals)} diagram(s) for: {plan.topic}")
            return visual_context, plan_dict

        except Exception as e:
            logger.warning(f"[visual-plan] Failed: {e}")
            return "", None

    async def process(
        self,
        message: str,
        client_id: str = "default",
        channel: str = "web",
    ) -> Dict:
        """
        Process a message. Returns dict with 'response' and 'citations'.
        """
        logger.info(f"[{channel}:{client_id}] Processing: {message[:80]}...")

        self.memory.save_message(client_id, "user", message)
        memory_context = await self.memory.auto_recall(message)
        history = self.memory.get_history(client_id, limit=20)
        messages = [{"role": h["role"], "content": h["content"]} for h in history]

        # Document RAG search
        doc_results = await self.memory.search_documents(message, chat_id=client_id, top_k=5)
        doc_context, citations = self.memory.format_doc_context(doc_results)

        system_prompt = self._build_system_prompt(memory_context, doc_context, message=message, chat_id=client_id)
        tool_schemas = self.tools.get_tool_schemas()

        response_text = await self._agent_loop(messages, system_prompt, tool_schemas)

        self.memory.save_message(client_id, "assistant", response_text)
        await self.memory.auto_capture(message, response_text, client_id)

        logger.info(f"[{channel}:{client_id}] Response: {response_text[:80]}...")
        return {"response": response_text, "citations": citations}


    async def process_stream(
        self,
        message: str,
        client_id: str = "default",
        channel: str = "web",
    ) -> AsyncGenerator[Dict, None]:
        """
        Stream response tokens with full tool-call support.
        Now includes visual-first planning for learning queries.
        """
        self.memory.save_message(client_id, "user", message)

        memory_context = await self.memory.auto_recall(message)
        history = self.memory.get_history(client_id, limit=20)
        messages = [{"role": h["role"], "content": h["content"]} for h in history]

        # Document RAG search
        doc_results = await self.memory.search_documents(message, chat_id=client_id, top_k=5)
        doc_context, citations = self.memory.format_doc_context(doc_results)
        yield {"type": "citations", "citations": citations}

        # ── NEW: Visual-first planning for learning queries ──────────
        visual_context = ""
        visual_plan_dict = None

        LEARN_RE = re.compile(
            r'\b(learn|teach|explain|study|understand|how does|what is|walk me through)\b',
            re.IGNORECASE,
        )
        if LEARN_RE.search(message):
            visual_context, visual_plan_dict = await self._generate_visual_plan(message)

            # Send the plan to frontend so DiagramBuilder can render it
            if visual_plan_dict:
                yield {
                    "type": "visual_plan",
                    "plan": visual_plan_dict,
                }
        # ── END NEW ──────────────────────────────────────────────────

        system_prompt = self._build_system_prompt(
            memory_context, doc_context,
            message=message, chat_id=client_id,
            visual_context=visual_context, 
        )
        tool_schemas = self.tools.get_tool_schemas()

        full_response, media = await self._agent_loop_with_media(
            messages, system_prompt, tool_schemas
        )

        if media["images"] or media["videos"]:
            yield {"type": "media", "images": media["images"], "videos": media["videos"]}

        words = full_response.split(" ")
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            yield {"type": "token", "content": chunk}

        self.memory.save_message(client_id, "assistant", full_response)
        asyncio.create_task(self.memory.auto_capture(message, full_response, client_id))


    async def process_teaching(self, full_response: str, user_message: str, chat_id: str = "") -> Optional[Dict]:
        """
        Post-process an LLM response into a structured whiteboard scene.
        Returns a dict matching WhiteboardScene schema, or None if parsing fails.

        - Cleans text for TTS and whiteboard
        - Generates one-line subtitles (shown one at a time)
        - Includes milestone listing as initial whiteboard actions
        """
        # Clean the response for scene generation
        cleaned_response = clean_for_whiteboard(full_response)

        # Fetch milestones for this chat to include on whiteboard
        milestone_section = ""

        prompt = (
            "You are a whiteboard layout engine. Given a tutoring explanation, "
            "convert it into a structured JSON whiteboard scene.\n\n"
            "Rules:\n"
            "- Split the explanation into 3-8 subtitles. Each subtitle is ONE complete sentence shown alone on screen.\n"
            "- Subtitles will be displayed ONE AT A TIME (not word by word). Keep each concise and self-contained.\n"
            "- For each subtitle that introduces a key concept, create a matching whiteboard action.\n"
            "- Whiteboard shows ONLY short labels and key facts. Subtitles handle the spoken explanations.\n"
            "- ALL text must be CLEAN: no markdown (no **, ##, `, ---), no emoji, no special symbols.\n"
            "- Write plain English sentences suitable for text-to-speech.\n"
            "- Position: x=column (usually 0), y=row (0,1,2...)\n"
            "- Style: 'heading' for titles/labels, 'body' for content, 'result' for answers\n"
            "- The marker field in a subtitle must match an action id exactly\n"
            "- Not every subtitle needs a marker. Explanatory phrases can have marker: null\n"
            f"{milestone_section}\n\n"
            "Return ONLY valid JSON (no markdown fences, no preamble):\n"
            "{\n"
            '  "title": "short topic title",\n'
            '  "clean_response": "full explanation as clean readable text for TTS (no markdown, no emoji)",\n'
            '  "subtitles": [\n'
            '    {"id": "sub-1", "text": "One complete sentence shown on screen", "marker": "step-1"},\n'
            '    {"id": "sub-2", "text": "Another sentence, no marker needed", "marker": null}\n'
            "  ],\n"
            '  "whiteboard": {\n'
            '    "actions": [\n'
            '      {"id": "step-1", "type": "create_text", "text": "Short board text", '
            '"position": {"x": 0, "y": 0}, "style": "heading"}\n'
            "    ]\n"
            "  }\n"
            "}\n\n"
            f"User question: {user_message[:300]}\n\n"
            f"Tutor explanation:\n{cleaned_response[:3000]}"
        )

        try:
            result = await self.llm.generate(
                messages=[{"role": "user", "content": prompt}],
                system_prompt=(
                    "You convert tutoring explanations into structured whiteboard JSON. "
                    "ALL text must be clean plain English with NO markdown, NO emoji, NO special formatting. "
                    "Return ONLY valid JSON."
                ),
            )
            content = result.get("content", "")

            # Strip markdown fences
            if "```" in content:
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()

            if "{" in content:
                json_str = content[content.index("{"):content.rindex("}") + 1]
                scene = json.loads(json_str)

                if "subtitles" in scene and "whiteboard" in scene:
                    if not scene.get("title"):
                        scene["title"] = clean_for_whiteboard(user_message[:60])
                    else:
                        scene["title"] = clean_for_whiteboard(scene["title"])

                    if not scene.get("clean_response"):
                        scene["clean_response"] = clean_for_tts(full_response)
                    else:
                        scene["clean_response"] = clean_for_tts(scene["clean_response"])

                    # Clean all subtitle text for TTS
                    for sub in scene.get("subtitles", []):
                        sub["text"] = clean_for_subtitle(sub.get("text", ""))

                    # Clean all whiteboard action text
                    for action in scene.get("whiteboard", {}).get("actions", []):
                        action["text"] = clean_for_whiteboard(action.get("text", ""))

                    return scene

        except Exception as e:
            logger.warning(f"Teaching scene generation failed: {e}")

        return None
        
        
    async def _agent_loop_with_media(
        self,
        messages: List[Dict],
        system_prompt: str,
        tool_schemas: List[Dict],
        max_iterations: int = None,
    ) -> Tuple[str, Dict]:
        """
        Like _agent_loop but also collects images/videos from web_fetch calls.
        Returns (response_text, {"images": [...], "videos": [...]}).
        """
        max_iterations = max_iterations or settings.max_tool_calls
        iteration = 0
        media: Dict = {"images": [], "videos": []}
        tool_call_counts: Dict[str, int] = {}
        MAX_SAME_TOOL = 1  # prevent duplicate tool calls

        while iteration < max_iterations:
            result = await self.llm.generate(
                messages=messages,
                system_prompt=system_prompt,
                tools=tool_schemas if tool_schemas else None,
            )

            if result["type"] == "text":
                return result["content"], media

            if result["type"] == "tool_calls":
                tool_calls = result["tool_calls"]
                assistant_content = result.get("content", "")

                for tc in tool_calls:
                    # Deduplication check
                    tool_call_counts[tc['name']] = tool_call_counts.get(tc['name'], 0) + 1
                    if tool_call_counts[tc['name']] > MAX_SAME_TOOL:
                        logger.warning(f"Skipping duplicate tool call: {tc['name']}")
                        continue
                    
                    logger.info(f"Tool call: {tc['name']}({tc.get('arguments', '')})")
                    args = tc.get("arguments", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}
                    try:
                        tool_result = await self.tools.execute(tc["name"], args)

                        # Collect scraped media from web_fetch results
                        if tc["name"] == "web_fetch" and isinstance(tool_result, dict):
                            for img in tool_result.get("images", []):
                                if img not in media["images"]:
                                    media["images"].append(img)
                            for vid in tool_result.get("videos", []):
                                if vid not in media["videos"]:
                                    media["videos"].append(vid)

                        result_str = json.dumps(tool_result) if isinstance(tool_result, dict) else str(tool_result)
                    except Exception as e:
                        result_str = f"Error: {str(e)}"

                    if settings.llm_provider == "openai":
                        messages.append({
                            "role": "assistant",
                            "content": assistant_content,
                            "tool_calls": [{
                                "id": tc["id"],
                                "type": "function",
                                "function": {"name": tc["name"], "arguments": json.dumps(args)}
                            }]
                        })
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": result_str,
                        })
                    else:
                        messages.append({"role": "assistant", "content": f"[Using {tc['name']}]"})
                        messages.append({"role": "user", "content": f"Tool result for {tc['name']}: {result_str}"})

                iteration += 1
                continue

            return result.get("content", "I couldn't generate a response."), media

        return "Reached maximum tool call limit.", media

    async def _agent_loop(
        self,
        messages: List[Dict],
        system_prompt: str,
        tool_schemas: List[Dict],
        max_iterations: int = None,
    ) -> str:
        max_iterations = max_iterations or settings.max_tool_calls
        iteration = 0
        tool_call_counts: Dict[str, int] = {}
        MAX_SAME_TOOL = 1  # prevent duplicate tool calls

        while iteration < max_iterations:
            result = await self.llm.generate(
                messages=messages,
                system_prompt=system_prompt,
                tools=tool_schemas if tool_schemas else None,
            )

            if result["type"] == "text":
                return result["content"]

            if result["type"] == "tool_calls":
                tool_calls = result["tool_calls"]
                assistant_content = result.get("content", "")

                for tc in tool_calls:
                    # Deduplication check
                    tool_call_counts[tc['name']] = tool_call_counts.get(tc['name'], 0) + 1
                    if tool_call_counts[tc['name']] > MAX_SAME_TOOL:
                        logger.warning(f"Skipping duplicate tool call: {tc['name']}")
                        continue
                    
                    logger.info(f"Tool call: {tc['name']}({tc.get('arguments', '')})")
                    args = tc.get("arguments", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}
                    try:
                        tool_result = await self.tools.execute(tc["name"], args)
                        result_str = json.dumps(tool_result) if isinstance(tool_result, dict) else str(tool_result)
                    except Exception as e:
                        result_str = f"Error: {str(e)}"

                    if settings.llm_provider == "openai":
                        messages.append({
                            "role": "assistant",
                            "content": assistant_content,
                            "tool_calls": [{
                                "id": tc["id"],
                                "type": "function",
                                "function": {"name": tc["name"], "arguments": json.dumps(args)}
                            }]
                        })
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": result_str,
                        })
                    else:
                        messages.append({"role": "assistant", "content": f"[Using {tc['name']}]"})
                        messages.append({"role": "user", "content": f"Tool result for {tc['name']}: {result_str}"})

                iteration += 1
                continue

            return result.get("content", "I couldn't generate a response.")

        return "Reached maximum tool call limit."

    def _build_system_prompt(self, memory_context: str, doc_context: str = "", message: str = "", chat_id: str = "", visual_context: str = "") -> str:
        parts = [self.get_personality()]

        # Inject chat_id for tool calls
        if chat_id:
            parts.append(f"\nCurrent chat_id: {chat_id}\nAlways use this exact chat_id when calling create_learning_plan or milestone_check.")

        # ── NEW: Inject visual context BEFORE learning mode ──────────
        # This way the LLM knows what figures exist when it writes the explanation
        if visual_context:
            parts.append(visual_context)
        # ── END NEW ──────────────────────────────────────────────────

        # Inject learning mode instructions only when needed
        LEARNING_RE = re.compile(
            r'\b(learn|teach me|explain|study|understand|how does|what is|walk me through)\b',
            re.IGNORECASE
        )
        if LEARNING_RE.search(message):
            learning_path = settings.agent_personality.replace("personality.txt", "learning_mode.txt")
            if os.path.exists(learning_path):
                with open(learning_path) as f:
                    parts.append(f.read())

        if memory_context:
            parts.append(f"\n--- YOUR MEMORY ---\n{memory_context}\n--- END MEMORY ---\n")

        if doc_context:
            parts.append(doc_context)

        parts.append(
            "\nYou have memory tools available:\n"
            "- memory_store: Save important info\n"
            "- memory_search: Search stored memories\n"
            "- memory_get: Read a memory file\n"
            "- search_all_chats: Search across all past chat sessions\n"
            "\nAutomatically store important user info.\n"
        )

        return "\n".join(parts)


async def maybe_create_milestones(chat_id: str, message: str):
    """Detect learning intent and auto-create milestones."""
    pattern = re.compile(
        r"(?:i\s+(?:wanna|want to|need to)\s+(?:learn|understand|study)|"
        r"(?:teach|explain)\s+me\s+(?:about\s+)?|how\s+does\s+|what\s+is\s+)(.{3,60}?)(?:\?|$|\.)",
        re.IGNORECASE,
    )
    m = pattern.search(message.strip())
    if not m:
        return
    topic = m.group(1).strip().rstrip("?.,!")
    if len(topic) < 4:
        return

    store = get_milestone_store()
    # Don't duplicate
    if store.get_plan_for_topic(chat_id, topic):
        return

    # 5-milestone framework
    titles = [
        ("Exposure",        f"First contact with {topic} — student recognizes it and shows curiosity."),
        ("Understanding",   f"Grasps the core meaning, vocabulary, and key concepts of {topic}."),
        ("Guided Practice", f"Works through {topic} tasks with support and feedback."),
        ("Independence",    f"Completes {topic} tasks alone and self-checks their work."),
        ("Creative Use",    f"Applies {topic} in new ways, solves problems, or creates something."),
    ]
    milestones = [
        Milestone(
            milestone_id=str(uuid.uuid4())[:8],
            title=f"{t[0]} of {topic}",
            description=t[1],
            order=i + 1,
            status=MilestoneStatus.AVAILABLE if i == 0 else MilestoneStatus.LOCKED,
        )
        for i, t in enumerate(titles)
    ]
    plan = MilestonePlan(
        plan_id=str(uuid.uuid4())[:12],
        chat_id=chat_id,
        subject="General",
        topic=topic,
        milestones=milestones,
    )
    store.save_plan(plan)
    logger.info(f"[milestones] Created plan for topic: {topic}")


# Singleton
_gateway: Optional[Gateway] = None

def get_gateway() -> Gateway:
    global _gateway
    if _gateway is None:
        _gateway = Gateway()
    return _gateway