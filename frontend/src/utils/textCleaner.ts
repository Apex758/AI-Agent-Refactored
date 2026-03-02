/**
 * Text Cleaning Utilities
 * Strips markdown, emoji, and special characters for clean TTS and whiteboard display.
 */

/** Clean text for TTS speech — removes all formatting artifacts */
export function cleanForTTS(text: string): string {
  if (!text) return ''

  let s = text

  // Remove code blocks
  s = s.replace(/```[\s\S]*?```/g, ' code block ')
  s = s.replace(/`[^`]+`/g, '')

  // Remove markdown headers
  s = s.replace(/#{1,6}\s*/g, '')

  // Remove bold/italic markers
  s = s.replace(/\*{1,3}/g, '')
  s = s.replace(/_{1,3}/g, '')

  // Remove markdown links [text](url) -> text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // Remove bare URLs
  s = s.replace(/https?:\/\/\S+/g, 'link')

  // Remove arrows and special symbols
  s = s.replace(/→/g, 'becomes')
  s = s.replace(/->/g, 'becomes')
  s = s.replace(/=>/g, 'becomes')
  s = s.replace(/---+/g, '')
  s = s.replace(/—/g, ', ')
  s = s.replace(/–/g, ', ')

  // Remove emoji (common ranges)
  s = s.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{FE00}-\u{FE0F}\u{200D}\u{2B50}\u{2B55}]+/gu,
    ' '
  )

  // Remove list markers at start of lines
  s = s.replace(/^\s*[-*+]\s+/gm, '')
  s = s.replace(/^\s*\d+\.\s+/gm, '')

  // Collapse whitespace
  s = s.replace(/\n{2,}/g, '. ')
  s = s.replace(/\n/g, ' ')
  s = s.replace(/\s{2,}/g, ' ')

  return s.trim()
}

/** Clean text for whiteboard display — keeps structure, removes markdown noise */
export function cleanForWhiteboard(text: string): string {
  if (!text) return ''

  let s = text

  // Remove markdown bold/italic
  s = s.replace(/\*{1,3}/g, '')
  s = s.replace(/_{1,3}/g, '')

  // Remove headers
  s = s.replace(/#{1,6}\s*/g, '')

  // Clean links
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // Remove code fences
  s = s.replace(/```\w*\n?/g, '')
  s = s.replace(/`/g, '')

  // Remove horizontal rules
  s = s.replace(/^---+\s*$/gm, '')

  // Remove emoji
  s = s.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{FE00}-\u{FE0F}\u{200D}\u{2B50}\u{2B55}]+/gu,
    ''
  )

  // Collapse excess whitespace
  s = s.replace(/\n{3,}/g, '\n\n')
  s = s.replace(/[ \t]{2,}/g, ' ')

  return s.trim()
}

/** Clean text for subtitle display — single line, no symbols */
export function cleanForSubtitle(text: string): string {
  let s = cleanForTTS(text)
  s = s.replace(/[\n\r]+/g, ' ')
  s = s.replace(/\.+$/, '')
  return s.trim()
}