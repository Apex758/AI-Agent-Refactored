"""
Agent Gateway — Central orchestrator.

Flow:
  1. Channel receives message → Gateway.process()
  2. Memory auto-recall (inject relevant context)
  3. Build prompt with personality + memory + tools
  4. LLM generates response (may call tools)
  5. Execute tool calls, feed results back to LLM
  6. Memory auto-capture (store important info)
  7. Return response to channel
"""
import json
import os
from typing import Dict, List, Optional, AsyncGenerator

from app.core.config import settings
from app.core.logging import logger
from app.core.llm import get_llm
from app.memory.manager import get_memory
from app.tools.registry import get_tool_registry


class Gateway:
    """
    The agent gateway. Every message flows through here regardless of channel.
    """

    def __init__(self):
        self.llm = get_llm()
        self.memory = get_memory()
        self.tools = get_tool_registry()
        self._personality = None

    def get_personality(self) -> str:
        """Load agent personality from file."""
        if self._personality is not None:
            return self._personality

        personality_path = settings.agent_personality
        for candidate in [personality_path, f"../{personality_path}", f"data/{personality_path}"]:
            if os.path.exists(candidate):
                with open(candidate) as f:
                    self._personality = f.read()
                return self._personality

        # Default personality
        self._personality = (
            f"You are {settings.agent_name}, a personal AI agent. "
            "You have persistent memory — you remember past conversations and user preferences. "
            "You can use tools to search the web, read files, and perform actions. "
            "You automatically store important information for later recall.\n\n"
            "When responding:\n"
            "- Be concise and actionable\n"
            "- Use your memory to personalize responses\n"
            "- Use tools when needed, don't guess\n"
            "- If you learn something new about the user, store it in memory\n"
        )
        return self._personality

    async def process(
        self,
        message: str,
        client_id: str = "default",
        channel: str = "web",
    ) -> str:
        """
        Process a message through the full pipeline.
        Returns the final assistant response text.
        """
        logger.info(f"[{channel}:{client_id}] Processing: {message[:80]}...")

        # 1. Save user message
        self.memory.save_message(client_id, "user", message)

        # 2. Auto-recall relevant memories
        memory_context = await self.memory.auto_recall(message)

        # 3. Build conversation history
        history = self.memory.get_history(client_id, limit=20)
        messages = [{"role": h["role"], "content": h["content"]} for h in history]

        # 4. Build system prompt
        system_prompt = self._build_system_prompt(memory_context)

        # 5. Get tool schemas
        tool_schemas = self.tools.get_tool_schemas()

        # 6. Generate response (with tool loop)
        response_text = await self._agent_loop(messages, system_prompt, tool_schemas)

        # 7. Save assistant message
        self.memory.save_message(client_id, "assistant", response_text)

        # 8. Auto-capture memories
        await self.memory.auto_capture(message, response_text, client_id)

        logger.info(f"[{channel}:{client_id}] Response: {response_text[:80]}...")
        return response_text

    async def process_stream(
        self,
        message: str,
        client_id: str = "default",
        channel: str = "web",
    ) -> AsyncGenerator[str, None]:
        """Stream response tokens."""
        self.memory.save_message(client_id, "user", message)
        memory_context = await self.memory.auto_recall(message)
        history = self.memory.get_history(client_id, limit=20)
        messages = [{"role": h["role"], "content": h["content"]} for h in history]
        system_prompt = self._build_system_prompt(memory_context)

        full_response = ""
        async for token in self.llm.stream(messages, system_prompt):
            full_response += token
            yield token

        self.memory.save_message(client_id, "assistant", full_response)
        await self.memory.auto_capture(message, full_response, client_id)

    async def _agent_loop(
        self,
        messages: List[Dict],
        system_prompt: str,
        tool_schemas: List[Dict],
        max_iterations: int = None,
    ) -> str:
        """
        Agentic loop: LLM → tool calls → results → LLM → ... → final text.
        """
        max_iterations = max_iterations or settings.max_tool_calls
        iteration = 0

        while iteration < max_iterations:
            result = await self.llm.generate(
                messages=messages,
                system_prompt=system_prompt,
                tools=tool_schemas if tool_schemas else None,
            )

            if result["type"] == "text":
                return result["content"]

            if result["type"] == "tool_calls":
                # Add assistant message with tool calls info
                tool_calls = result["tool_calls"]
                assistant_content = result.get("content", "")

                for tc in tool_calls:
                    logger.info(f"Tool call: {tc['name']}({tc.get('arguments', '')})")

                    # Parse arguments
                    args = tc.get("arguments", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}

                    # Execute tool
                    try:
                        tool_result = await self.tools.execute(tc["name"], args)
                        result_str = json.dumps(tool_result) if isinstance(tool_result, dict) else str(tool_result)
                    except Exception as e:
                        result_str = f"Error: {str(e)}"

                    # Feed result back based on provider
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
                        # Anthropic style
                        messages.append({"role": "assistant", "content": f"[Using {tc['name']}]"})
                        messages.append({"role": "user", "content": f"Tool result for {tc['name']}: {result_str}"})

                iteration += 1
                continue

            return result.get("content", "I couldn't generate a response.")

        return "Reached maximum tool call limit."

    def _build_system_prompt(self, memory_context: str) -> str:
        """Build the full system prompt with personality + memory + tool instructions."""
        parts = [self.get_personality()]

        if memory_context:
            parts.append(f"\n--- YOUR MEMORY ---\n{memory_context}\n--- END MEMORY ---\n")

        # Add memory tool instructions
        parts.append(
            "\nYou have memory tools available:\n"
            "- memory_store: Save important info (preferences, facts, decisions)\n"
            "- memory_search: Search your stored memories semantically\n"
            "- memory_get: Read a specific memory file\n"
            "\nAutomatically store important user info. Your memory persists across sessions.\n"
        )

        return "\n".join(parts)


# Singleton
_gateway: Optional[Gateway] = None

def get_gateway() -> Gateway:
    global _gateway
    if _gateway is None:
        _gateway = Gateway()
    return _gateway
