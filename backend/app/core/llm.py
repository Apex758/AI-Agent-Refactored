"""
LLM abstraction layer. Supports OpenAI, Anthropic, and OpenRouter via API keys.
Swap providers by changing LLM_PROVIDER in .env.

Dual-model support:
  - llm.generate(...)              → uses SMALL model (teaching/general)
  - llm.generate(..., use_deep=True) → uses DEEP model (breakdown generation)
"""
from typing import List, Dict, Optional, AsyncGenerator
from app.core.config import settings
from app.core.logging import logger


class LLMMessage:
    def __init__(self, role: str, content: str):
        self.role = role
        self.content = content

    def to_dict(self):
        return {"role": self.role, "content": self.content}


class LLM:
    """Unified LLM interface for OpenAI, Anthropic, and OpenRouter."""

    def __init__(self):
        self.provider = settings.llm_provider
        self.small_model = settings.llm_small_model
        self.deep_model = settings.llm_deep_model
        self.temperature = settings.llm_temperature
        self.max_tokens = settings.llm_max_tokens
        self._client = None
        logger.info(
            f"LLM initialized: provider={self.provider}, "
            f"small={self.small_model}, deep={self.deep_model}"
        )

    def _resolve_model(self, use_deep: bool = False) -> str:
        """Pick the right model string for this call."""
        model = self.deep_model if use_deep else self.small_model
        if use_deep:
            logger.info(f"Using DEEP model: {model}")
        return model

    # ── Client getters (unchanged) ──────────────────────────────

    def _get_openai_client(self):
        if self._client is None:
            from openai import AsyncOpenAI
            self._client = AsyncOpenAI(api_key=settings.openai_api_key)
            logger.info("Created new OpenAI client")
        return self._client

    def _get_anthropic_client(self):
        if self._client is None:
            from anthropic import AsyncAnthropic
            self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
            logger.info("Created new Anthropic client")
        return self._client

    def _get_openrouter_client(self):
        if self._client is None:
            from openai import AsyncOpenAI
            self._client = AsyncOpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=settings.openrouter_api_key,
            )
            logger.info("Created new OpenRouter client")
        return self._client

    # ── Public API ──────────────────────────────────────────────

    async def generate(
        self,
        messages: List[Dict],
        system_prompt: str = "",
        tools: Optional[List[Dict]] = None,
        use_deep: bool = False,
    ) -> str:
        """Generate a complete response. use_deep=True → DEEP model."""
        model = self._resolve_model(use_deep)
        if self.provider == "anthropic":
            return await self._generate_anthropic(messages, system_prompt, tools, model)
        elif self.provider == "openrouter":
            return await self._generate_openrouter(messages, system_prompt, tools, model)
        return await self._generate_openai(messages, system_prompt, tools, model)

    async def stream(
        self,
        messages: List[Dict],
        system_prompt: str = "",
        use_deep: bool = False,
    ) -> AsyncGenerator[str, None]:
        """Stream response tokens. use_deep=True → DEEP model."""
        model = self._resolve_model(use_deep)
        if self.provider == "anthropic":
            async for token in self._stream_anthropic(messages, system_prompt, model):
                yield token
        elif self.provider == "openrouter":
            async for token in self._stream_openrouter(messages, system_prompt, model):
                yield token
        else:
            async for token in self._stream_openai(messages, system_prompt, model):
                yield token

    # ── OpenAI ──────────────────────────────────────────────────

    async def _generate_openai(self, messages, system_prompt, tools, model):
        client = self._get_openai_client()
        msgs = []
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
        msgs.extend(messages)

        kwargs = dict(
            model=model,
            messages=msgs,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        response = await client.chat.completions.create(**kwargs)
        msg = response.choices[0].message

        if msg.tool_calls:
            return {"type": "tool_calls", "tool_calls": [
                {
                    "id": tc.id,
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                }
                for tc in msg.tool_calls
            ], "content": msg.content or ""}

        return {"type": "text", "content": msg.content or ""}

    async def _stream_openai(self, messages, system_prompt, model):
        client = self._get_openai_client()
        msgs = []
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
        msgs.extend(messages)

        stream = await client.chat.completions.create(
            model=model,
            messages=msgs,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content

    # ── Anthropic ───────────────────────────────────────────────

    async def _generate_anthropic(self, messages, system_prompt, tools, model):
        client = self._get_anthropic_client()

        kwargs = dict(
            model=model,
            messages=messages,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
        )
        if system_prompt:
            kwargs["system"] = system_prompt
        if tools:
            kwargs["tools"] = self._convert_tools_to_anthropic(tools)

        response = await client.messages.create(**kwargs)

        tool_blocks = [b for b in response.content if b.type == "tool_use"]
        if tool_blocks:
            text_blocks = [b for b in response.content if b.type == "text"]
            return {"type": "tool_calls", "tool_calls": [
                {"id": tb.id, "name": tb.name, "arguments": tb.input}
                for tb in tool_blocks
            ], "content": text_blocks[0].text if text_blocks else ""}

        return {"type": "text", "content": response.content[0].text}

    async def _stream_anthropic(self, messages, system_prompt, model):
        client = self._get_anthropic_client()
        kwargs = dict(
            model=model,
            messages=messages,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
        )
        if system_prompt:
            kwargs["system"] = system_prompt

        async with client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text

    def _convert_tools_to_anthropic(self, openai_tools):
        """Convert OpenAI tool format to Anthropic format."""
        anthropic_tools = []
        for tool in openai_tools:
            fn = tool.get("function", tool)
            anthropic_tools.append({
                "name": fn["name"],
                "description": fn.get("description", ""),
                "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
            })
        return anthropic_tools

    # ── OpenRouter ──────────────────────────────────────────────

    async def _generate_openrouter(self, messages, system_prompt, tools, model):
        """Generate using OpenRouter (OpenAI-compatible API)."""
        client = self._get_openrouter_client()
        msgs = []
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
        msgs.extend(messages)

        kwargs = dict(
            model=model,
            messages=msgs,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        response = await client.chat.completions.create(**kwargs)
        msg = response.choices[0].message

        if msg.tool_calls:
            return {"type": "tool_calls", "tool_calls": [
                {
                    "id": tc.id,
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                }
                for tc in msg.tool_calls
            ], "content": msg.content or ""}

        return {"type": "text", "content": msg.content or ""}

    async def _stream_openrouter(self, messages, system_prompt, model):
        """Stream using OpenRouter (OpenAI-compatible API)."""
        client = self._get_openrouter_client()
        msgs = []
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
        msgs.extend(messages)

        stream = await client.chat.completions.create(
            model=model,
            messages=msgs,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content


# Singleton
_llm: Optional[LLM] = None

def get_llm() -> LLM:
    global _llm
    if _llm is None:
        _llm = LLM()
    return _llm