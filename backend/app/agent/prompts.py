"""
Prompt templates for the agent.
"""
import os
from typing import Optional


def get_system_prompt() -> str:
    """
    Get the system prompt for the agent.
    """
    # Try to load from personality.txt
    personality_path = os.path.join(os.path.dirname(__file__), "..", "..", "personality.txt")
    
    if os.path.exists(personality_path):
        with open(personality_path, "r") as f:
            return f.read()
    
    # Default system prompt
    return """You are a helpful AI assistant. You have access to various tools to help you answer questions and complete tasks.

When responding:
- Provide accurate, well-reasoned answers
- Use tools when appropriate to gather information
- Be clear and concise in your explanations
- Admit when you're uncertain about something

You can use the following tools:
- web_retrieval: Search the web for information
- scraper: Fetch and extract content from web pages
- filesystem: Read files from the filesystem

Always try to be helpful and provide value to the user."""


def get_tool_use_prompt(available_tools: list) -> str:
    """
    Get a prompt for when the agent needs to use tools.
    """
    tools_description = "\n".join([
        f"- {tool.name}: {tool.description}" 
        for tool in available_tools
    ])
    
    return f"""You have access to the following tools:

{tools_description}

When you need to use a tool, respond in the following format:
```
<tool_call>
<tool name="tool_name">
<param name="param1">value1</param>
<param name="param2">value2</param>
</tool>
</tool_call>
```

After receiving tool results, provide your final answer based on the information gathered."""


def get_context_prompt(context: list) -> str:
    """
    Get a prompt with relevant context.
    """
    if not context:
        return ""
    
    context_str = "\n\nRelevant information:\n"
    for i, item in enumerate(context, 1):
        context_str += f"{i}. {item.get('content', '')}\n"
    
    return context_str


def get_memory_prompt(memories: list) -> str:
    """
    Get a prompt with relevant memories.
    """
    if not memories:
        return ""
    
    memory_str = "\n\nRelevant past conversations:\n"
    for memory in memories:
        memory_str += f"- {memory.get('content', '')}\n"
    
    return memory_str


def get_planning_prompt(task: str) -> str:
    """
    Get a prompt for planning complex tasks.
    """
    return f"""Break down the following task into steps:

{task}

Provide a numbered list of steps to complete this task."""


def get_reflection_prompt(response: str, tool_results: list) -> str:
    """
    Get a prompt for reflecting on the response and tool results.
    """
    return f"""You have received the following tool results:
{tool_results}

Your initial response was:
{response}

Review your response and tool results. If needed, provide additional information or corrections."""