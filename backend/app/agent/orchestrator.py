"""
Agent orchestrator - coordinates tool execution and response generation.
"""
from typing import Dict, List, Optional, AsyncGenerator
import asyncio

from app.agent.models import AgentState, AgentResponse
from app.agent.prompts import get_system_prompt
from app.agent.streaming import StreamingHandler
from app.tools.registry import ToolRegistry
from app.memory.short_term import ShortTermMemory
from app.memory.long_term import LongTermMemory
from app.retrieval.retrieve import Retriever
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class AgentOrchestrator:
    """
    Orchestrates the agent's response generation process.
    """
    
    def __init__(self):
        self.tool_registry = ToolRegistry()
        self.retriever = Retriever()
        self.max_tool_calls = settings.max_tool_calls
    
    async def process_message(
        self, 
        message: str, 
        client_id: str = "default",
        streaming_handler: Optional[StreamingHandler] = None
    ) -> Dict:
        """
        Process a user message and generate a response.
        """
        # Get memory
        short_term = ShortTermMemory(client_id)
        long_term = LongTermMemory()
        
        # Add user message to memory
        await short_term.add_message("user", message)
        
        # Get conversation history
        history = await short_term.get_conversation()
        
        # Retrieve relevant context
        context = await self.retriever.retrieve(message, top_k=settings.retrieval_top_k)
        
        # Get long-term memories
        long_term_memories = await long_term.search(message, limit=settings.long_term_top_k)
        
        # Build the full prompt
        system_prompt = get_system_prompt()
        
        # Generate response using LLM
        response = await self._generate_response(
            message=message,
            history=history,
            context=context,
            long_term_memories=long_term_memories,
            system_prompt=system_prompt,
            streaming_handler=streaming_handler
        )
        
        # Add assistant response to memory
        await short_term.add_message("assistant", response["message"])
        
        # Check if we should store important info in long-term memory
        if self._should_store_long_term(response["message"]):
            await long_term.store(
                f"User asked: {message}\nAssistant responded: {response['message']}",
                {"client_id": client_id, "type": "conversation"}
            )
        
        return response
    
    async def _generate_response(
        self,
        message: str,
        history: List[Dict],
        context: List[Dict],
        long_term_memories: List[Dict],
        system_prompt: str,
        streaming_handler: Optional[StreamingHandler] = None
    ) -> Dict:
        """
        Generate a response using the LLM.
        """
        from langchain_openai import ChatOpenAI
        from langchain.schema import HumanMessage, SystemMessage
        
        # Build context string
        context_str = ""
        if context:
            context_str = "\n\nRelevant context:\n" + "\n".join([
                f"- {c.get('content', '')}" for c in context
            ])
        
        memory_str = ""
        if long_term_memories:
            memory_str = "\n\nRelevant memories:\n" + "\n".join([
                f"- {m.get('content', '')}" for m in long_term_memories
            ])
        
        # Build messages
        messages = [SystemMessage(content=system_prompt)]
        
        # Add history (last 10 messages)
        for msg in history[-10:]:
            messages.append(HumanMessage(content=msg.get("content", "")))
        
        # Add current message with context
        current_message = f"{message}{context_str}{memory_str}"
        messages.append(HumanMessage(content=current_message))
        
        # Initialize LLM
        llm = ChatOpenAI(
            model=settings.openai_model,
            temperature=settings.openai_temperature,
            max_tokens=settings.openai_max_tokens,
            streaming=streaming_handler is not None
        )
        
        # Generate response
        if streaming_handler:
            # Handle streaming
            full_response = ""
            async for chunk in llm.astream(messages):
                content = chunk.content
                full_response += content
                await streaming_handler.send_token(content)
            
            return {
                "message": full_response,
                "tool_calls": [],
                "sources": [c.get("source") for c in context] if context else []
            }
        else:
            # Non-streaming
            response = await llm.agenerate([messages])
            message_content = response.generations[0][0].text
            
            return {
                "message": message_content,
                "tool_calls": [],
                "sources": [c.get("source") for c in context] if context else []
            }
    
    def _should_store_long_term(self, response: str) -> bool:
        """
        Determine if the response should be stored in long-term memory.
        """
        # Simple heuristic: store if response is substantial
        return len(response) > 200
    
    async def process_message_streaming(
        self,
        message: str,
        client_id: str = "default"
    ) -> AsyncGenerator[Dict, None]:
        """
        Process a message and yield streaming chunks.
        """
        short_term = ShortTermMemory(client_id)
        await short_term.add_message("user", message)
        
        history = await short_term.get_conversation()
        context = await self.retriever.retrieve(message, top_k=settings.retrieval_top_k)
        
        system_prompt = get_system_prompt()
        
        async for chunk in self._generate_response_streaming(
            message=message,
            history=history,
            context=context,
            system_prompt=system_prompt
        ):
            yield chunk
    
    async def _generate_response_streaming(
        self,
        message: str,
        history: List[Dict],
        context: List[Dict],
        system_prompt: str
    ) -> AsyncGenerator[Dict, None]:
        """
        Generate streaming response.
        """
        from langchain_openai import ChatOpenAI
        from langchain.schema import HumanMessage, SystemMessage
        
        context_str = ""
        if context:
            context_str = "\n\nRelevant context:\n" + "\n".join([
                f"- {c.get('content', '')}" for c in context
            ])
        
        messages = [SystemMessage(content=system_prompt)]
        
        for msg in history[-10:]:
            messages.append(HumanMessage(content=msg.get("content", "")))
        
        messages.append(HumanMessage(content=f"{message}{context_str}"))
        
        llm = ChatOpenAI(
            model=settings.openai_model,
            temperature=settings.openai_temperature,
            max_tokens=settings.openai_max_tokens,
            streaming=True
        )
        
        full_response = ""
        async for chunk in llm.astream(messages):
            content = chunk.content
            full_response += content
            yield {"type": "token", "content": content}
        
        # Store in memory
        yield {"type": "complete", "message": full_response}