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
import json
import os
from typing import Dict, List, Optional, AsyncGenerator, Tuple

from app.core.config import settings
from app.core.logging import logger
from app.core.llm import get_llm
from app.memory.manager import get_memory
from app.tools.registry import get_tool_registry


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
                with open(candidate) as f:
                    self._personality = f.read()
                return self._personality
        self._personality = (
            f"You are {settings.agent_name}, a personal AI agent. "
            "You have persistent memory and can use tools. "
            "When you reference document content, mention the source filename naturally."
        )
        return self._personality

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

        system_prompt = self._build_system_prompt(memory_context, doc_context)
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
        Stream response tokens. Yields dicts:
          {"type": "token", "content": "..."}
          {"type": "citations", "citations": [...]}  ← sent before first token
        """
        self.memory.save_message(client_id, "user", message)
        memory_context = await self.memory.auto_recall(message)
        history = self.memory.get_history(client_id, limit=20)
        messages = [{"role": h["role"], "content": h["content"]} for h in history]

        # Document RAG search — yield citations upfront
        doc_results = await self.memory.search_documents(message, chat_id=client_id, top_k=5)
        doc_context, citations = self.memory.format_doc_context(doc_results)

        # Send citations before streaming starts
        yield {"type": "citations", "citations": citations}

        system_prompt = self._build_system_prompt(memory_context, doc_context)

        full_response = ""
        async for token in self.llm.stream(messages, system_prompt):
            full_response += token
            yield {"type": "token", "content": token}

        self.memory.save_message(client_id, "assistant", full_response)
        asyncio.create_task(self.memory.auto_capture(message, full_response, client_id)) 

    async def _agent_loop(
        self,
        messages: List[Dict],
        system_prompt: str,
        tool_schemas: List[Dict],
        max_iterations: int = None,
    ) -> str:
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
                tool_calls = result["tool_calls"]
                assistant_content = result.get("content", "")

                for tc in tool_calls:
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

    def _build_system_prompt(self, memory_context: str, doc_context: str = "") -> str:
        parts = [self.get_personality()]

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


# Singleton
_gateway: Optional[Gateway] = None

def get_gateway() -> Gateway:
    global _gateway
    if _gateway is None:
        _gateway = Gateway()
    return _gateway