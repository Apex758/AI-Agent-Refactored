"""
Web retrieval tool implementation.
"""
import httpx
from typing import Dict, Any, List
from app.tools.registry import Tool
from app.core.logging import get_logger

logger = get_logger(__name__)


class WebRetrievalTool(Tool):
    """
    Tool for searching the web for information.
    """
    
    def __init__(self):
        super().__init__(
            name="web_retrieval",
            description="Search the web for information on a given query",
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query"
                    },
                    "num_results": {
                        "type": "integer",
                        "description": "Number of results to return",
                        "default": 5
                    }
                },
                "required": ["query"]
            }
        )
    
    async def execute(self, query: str, num_results: int = 5) -> Dict[str, Any]:
        """
        Execute web search.
        """
        logger.info(f"Web search: {query}")
        
        # Using DuckDuckGo API (free, no API key required)
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    "https://api.duckduckgo.com/",
                    params={
                        "q": query,
                        "format": "json",
                        "no_html": 1,
                        "skip_disambig": 1
                    },
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    results = []
                    
                    # Extract related topics
                    for topic in data.get("RelatedTopics", [])[:num_results]:
                        if isinstance(topic, dict):
                            results.append({
                                "title": topic.get("Text", ""),
                                "url": topic.get("URL", "")
                            })
                    
                    return {
                        "query": query,
                        "results": results,
                        "summary": data.get("AbstractText", "")
                    }
                else:
                    return {
                        "error": f"Search failed with status {response.status_code}",
                        "query": query
                    }
        except Exception as e:
            logger.error(f"Web search error: {e}")
            return {
                "error": str(e),
                "query": query
            }
    
    def validate_parameters(self, params: Dict) -> bool:
        """Validate tool parameters."""
        return "query" in params and isinstance(params["query"], str)