"""
Filesystem tool implementation.
"""
import os
from typing import Dict, Any, List
from pathlib import Path
from app.tools.registry import Tool
from app.core.logging import get_logger

logger = get_logger(__name__)


class FilesystemTool(Tool):
    """
    Tool for reading files from the filesystem.
    """
    
    def __init__(self, base_path: str = "."):
        super().__init__(
            name="filesystem",
            description="Read content from files in the filesystem",
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The file path to read"
                    },
                    "max_length": {
                        "type": "integer",
                        "description": "Maximum number of characters to read",
                        "default": 10000
                    }
                },
                "required": ["path"]
            }
        )
        self.base_path = Path(base_path).resolve()
    
    async def execute(self, path: str, max_length: int = 10000) -> Dict[str, Any]:
        """
        Execute file reading.
        """
        logger.info(f"Reading file: {path}")
        
        try:
            # Resolve the full path
            full_path = (self.base_path / path).resolve()
            
            # Security check: ensure path is within base_path
            if not str(full_path).startswith(str(self.base_path)):
                return {
                    "error": "Access denied: path is outside allowed directory",
                    "path": path
                }
            
            # Check if file exists
            if not full_path.exists():
                return {
                    "error": "File not found",
                    "path": path
                }
            
            # Check if it's a file
            if not full_path.is_file():
                return {
                    "error": "Path is not a file",
                    "path": path
                }
            
            # Read file content
            with open(full_path, "r", encoding="utf-8") as f:
                content = f.read(max_length)
            
            # Check if file was truncated
            truncated = len(content) >= max_length
            
            return {
                "path": path,
                "content": content,
                "truncated": truncated,
                "size": full_path.stat().st_size
            }
            
        except PermissionError:
            return {
                "error": "Permission denied",
                "path": path
            }
        except Exception as e:
            logger.error(f"Filesystem error: {e}")
            return {
                "error": str(e),
                "path": path
            }
    
    def validate_parameters(self, params: Dict) -> bool:
        """Validate tool parameters."""
        if "path" not in params:
            return False
        path = params["path"]
        return isinstance(path, str) and len(path) > 0


class FilesystemListTool(Tool):
    """
    Tool for listing directory contents.
    """
    
    def __init__(self, base_path: str = "."):
        super().__init__(
            name="filesystem_list",
            description="List contents of a directory",
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The directory path to list"
                    },
                    "recursive": {
                        "type": "boolean",
                        "description": "Whether to list recursively",
                        "default": False
                    }
                },
                "required": ["path"]
            }
        )
        self.base_path = Path(base_path).resolve()
    
    async def execute(self, path: str, recursive: bool = False) -> Dict[str, Any]:
        """
        Execute directory listing.
        """
        logger.info(f"Listing directory: {path}")
        
        try:
            full_path = (self.base_path / path).resolve()
            
            if not str(full_path).startswith(str(self.base_path)):
                return {
                    "error": "Access denied: path is outside allowed directory",
                    "path": path
                }
            
            if not full_path.exists():
                return {
                    "error": "Directory not found",
                    "path": path
                }
            
            if not full_path.is_dir():
                return {
                    "error": "Path is not a directory",
                    "path": path
                }
            
            items = []
            if recursive:
                for item in full_path.rglob("*"):
                    if item.is_file():
                        items.append(str(item.relative_to(full_path)))
            else:
                for item in full_path.iterdir():
                    items.append(item.name)
            
            return {
                "path": path,
                "items": items,
                "count": len(items)
            }
            
        except Exception as e:
            logger.error(f"Filesystem list error: {e}")
            return {
                "error": str(e),
                "path": path
            }