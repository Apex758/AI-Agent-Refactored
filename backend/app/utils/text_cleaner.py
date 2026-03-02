"""
Text Cleaning Utilities — Strip markdown, emoji, and special characters
for clean TTS speech and whiteboard display.
"""
import re


def clean_for_tts(text: str) -> str:
    """Clean text for text-to-speech output. Removes all formatting artifacts."""
    if not text:
        return ""

    s = text

    # Remove code blocks entirely (replace with "code block")
    s = re.sub(r'```[\s\S]*?```', ' code block ', s)
    s = re.sub(r'`[^`]+`', '', s)

    # Remove markdown headers
    s = re.sub(r'#{1,6}\s*', '', s)

    # Remove bold/italic markers
    s = re.sub(r'\*{1,3}', '', s)
    s = re.sub(r'_{1,3}', '', s)

    # Remove markdown links [text](url) -> text
    s = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', s)

    # Remove bare URLs
    s = re.sub(r'https?://\S+', 'link', s)

    # Remove arrows and special symbols
    s = s.replace('→', 'becomes')
    s = s.replace('->', 'becomes')
    s = s.replace('=>', 'becomes')
    s = s.replace('---', '')
    s = s.replace('—', ', ')
    s = s.replace('–', ', ')

    # Remove emoji (Unicode emoji ranges)
    s = re.sub(
        r'[\U0001F600-\U0001F64F'   # emoticons
        r'\U0001F300-\U0001F5FF'     # symbols & pictographs
        r'\U0001F680-\U0001F6FF'     # transport & map
        r'\U0001F1E0-\U0001F1FF'     # flags
        r'\U00002702-\U000027B0'     # dingbats
        r'\U000024C2-\U0001F251'     # misc
        r'\U0001f900-\U0001f9FF'     # supplemental
        r'\U00002600-\U000026FF'     # misc symbols
        r'\U0000FE00-\U0000FE0F'     # variation selectors
        r'\U0000200D'                # ZWJ
        r'\U00002B50\U00002B55'      # stars
        r']+',
        ' ',
        s,
        flags=re.UNICODE,
    )

    # Remove list markers at start of lines
    s = re.sub(r'^\s*[-*+]\s+', '', s, flags=re.MULTILINE)
    s = re.sub(r'^\s*\d+\.\s+', '', s, flags=re.MULTILINE)

    # Collapse whitespace
    s = re.sub(r'\n{2,}', '. ', s)
    s = re.sub(r'\n', ' ', s)
    s = re.sub(r'\s{2,}', ' ', s)

    return s.strip()


def clean_for_whiteboard(text: str) -> str:
    """Clean text for whiteboard display. Keeps structure but removes markdown noise."""
    if not text:
        return ""

    s = text

    # Remove markdown bold/italic
    s = re.sub(r'\*{1,3}', '', s)
    s = re.sub(r'_{1,3}', '', s)

    # Remove markdown headers
    s = re.sub(r'#{1,6}\s*', '', s)

    # Clean links
    s = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', s)

    # Remove code fences
    s = re.sub(r'```\w*\n?', '', s)
    s = re.sub(r'`', '', s)

    # Remove horizontal rules
    s = re.sub(r'^---+\s*$', '', s, flags=re.MULTILINE)

    # Remove emoji
    s = re.sub(
        r'[\U0001F600-\U0001F64F'
        r'\U0001F300-\U0001F5FF'
        r'\U0001F680-\U0001F6FF'
        r'\U0001F1E0-\U0001F1FF'
        r'\U00002702-\U000027B0'
        r'\U000024C2-\U0001F251'
        r'\U0001f900-\U0001f9FF'
        r'\U00002600-\U000026FF'
        r'\U0000FE00-\U0000FE0F'
        r'\U0000200D'
        r'\U00002B50\U00002B55'
        r']+',
        '',
        s,
        flags=re.UNICODE,
    )

    # Collapse excess whitespace but keep single newlines
    s = re.sub(r'\n{3,}', '\n\n', s)
    s = re.sub(r'[ \t]{2,}', ' ', s)

    return s.strip()


def clean_for_subtitle(text: str) -> str:
    """Clean text for subtitle overlay. Single line, no symbols."""
    s = clean_for_tts(text)
    # Ensure single line
    s = re.sub(r'[\n\r]+', ' ', s)
    # Remove trailing periods for subtitle feel
    s = s.rstrip('.')
    return s.strip()