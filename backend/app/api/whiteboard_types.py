"""
Whiteboard Scene types — structured payload for teaching mode.

Sent over WS as {"type": "whiteboard_scene", "scene": {...}}
"""
from pydantic import BaseModel
from typing import List, Optional


class ActionPosition(BaseModel):
    """Grid position. Frontend maps col/row → TLDraw coordinates."""
    x: int = 0   # column
    y: int = 0   # row


class WhiteboardAction(BaseModel):
    """A single TLDraw operation triggered by a subtitle marker."""
    id: str                              # matches subtitle.marker
    type: str = "create_text"            # create_text | highlight | create_box
    text: str = ""
    position: ActionPosition = ActionPosition()
    style: str = "body"                  # heading | body | result


class Subtitle(BaseModel):
    """One spoken phrase + its whiteboard marker."""
    id: str
    text: str                            # spoken by TTS, displayed in overlay
    marker: Optional[str] = None         # links to WhiteboardAction.id


class WhiteboardBlock(BaseModel):
    """All whiteboard actions for one scene."""
    actions: List[WhiteboardAction] = []


class WhiteboardScene(BaseModel):
    """Complete teaching payload returned by process_teaching()."""
    title: str = ""
    clean_response: str = ""             # full text for chat log
    subtitles: List[Subtitle] = []
    whiteboard: WhiteboardBlock = WhiteboardBlock()