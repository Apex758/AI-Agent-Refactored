"""
Tools API endpoints.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from app.tools.registry import ToolRegistry

router = APIRouter()


class ToolExecuteRequest(BaseModel):
    """Request model for tool execution."""
    tool_name: str
    parameters: dict = {}


class ToolResponse(BaseModel):
    """Response model for tool execution."""
    success: bool
    result: Optional[dict] = None
    error: Optional[str] = None


@router.get("/")
async def list_tools():
    """
    List all available tools.
    """
    registry = ToolRegistry()
    tools = registry.list_tools()
    
    return {
        "tools": [
            {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters
            }
            for tool in tools
        ]
    }


@router.get("/{tool_name}")
async def get_tool(tool_name: str):
    """
    Get details of a specific tool.
    """
    registry = ToolRegistry()
    tool = registry.get_tool(tool_name)
    
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")
    
    return {
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.parameters
    }


@router.post("/execute", response_model=ToolResponse)
async def execute_tool(request: ToolExecuteRequest):
    """
    Execute a tool with given parameters.
    """
    registry = ToolRegistry()
    tool = registry.get_tool(request.tool_name)
    
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool '{request.tool_name}' not found")
    
    try:
        result = await tool.execute(**request.parameters)
        return ToolResponse(success=True, result=result)
    except Exception as e:
        return ToolResponse(success=False, error=str(e))


@router.get("/policies/")
async def list_policies():
    """
    List all tool policies.
    """
    from app.tools.policy import ToolPolicy
    
    policies = ToolPolicy.get_all_policies()
    
    return {"policies": policies}