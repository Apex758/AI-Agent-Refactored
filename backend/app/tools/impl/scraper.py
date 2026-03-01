"""
Web scraper tool implementation.
"""
import httpx
from bs4 import BeautifulSoup
from typing import Dict, Any, Optional
from app.tools.registry import Tool
from app.core.logging import get_logger

logger = get_logger(__name__)


class ScraperTool(Tool):
    """
    Tool for fetching and extracting content from web pages.
    """
    
    def __init__(self):
        super().__init__(
            name="scraper",
            description="Fetch and extract content from a web page",
            parameters={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to fetch"
                    },
                    "extract_links": {
                        "type": "boolean",
                        "description": "Whether to extract links from the page",
                        "default": False
                    },
                    "max_length": {
                        "type": "integer",
                        "description": "Maximum content length to extract",
                        "default": 5000
                    }
                },
                "required": ["url"]
            }
        )
    
    async def execute(
        self, 
        url: str, 
        extract_links: bool = False,
        max_length: int = 5000
    ) -> Dict[str, Any]:
        """
        Execute web scraping.
        """
        logger.info(f"Scraping: {url}")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    url,
                    timeout=15.0,
                    follow_redirects=True,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    }
                )
                
                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, "lxml")
                    
                    # Remove script and style elements
                    for script in soup(["script", "style"]):
                        script.decompose()
                    
                    # Get text content
                    text = soup.get_text(separator="\n", strip=True)
                    
                    # Truncate if needed
                    if len(text) > max_length:
                        text = text[:max_length] + "..."
                    
                    result = {
                        "url": url,
                        "title": soup.title.string if soup.title else "",
                        "content": text,
                        "status_code": response.status_code
                    }
                    
                    # Extract links if requested
                    if extract_links:
                        links = []
                        for link in soup.find_all("a", href=True):
                            href = link["href"]
                            # Make absolute URLs
                            if href.startswith("/"):
                                from urllib.parse import urljoin
                                href = urljoin(url, href)
                            links.append({
                                "text": link.get_text(strip=True),
                                "href": href
                            })
                        result["links"] = links[:20]  # Limit to 20 links
                    
                    return result
                else:
                    return {
                        "error": f"Failed to fetch URL: status {response.status_code}",
                        "url": url,
                        "status_code": response.status_code
                    }
                    
        except httpx.TimeoutException:
            return {
                "error": "Request timed out",
                "url": url
            }
        except Exception as e:
            logger.error(f"Scraper error: {e}")
            return {
                "error": str(e),
                "url": url
            }
    
    def validate_parameters(self, params: Dict) -> bool:
        """Validate tool parameters."""
        if "url" not in params:
            return False
        url = params["url"]
        return isinstance(url, str) and (url.startswith("http://") or url.startswith("https://"))