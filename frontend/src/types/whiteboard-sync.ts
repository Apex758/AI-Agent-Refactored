// ── Whiteboard Scene Sync types ───────────────────────────────────

export interface ActionPosition {
  x: number   // column in grid
  y: number   // row in grid
}

export interface WhiteboardAction {
  id: string
  type: 'create_text' | 'highlight' | 'create_box'
  text: string
  position: ActionPosition
  style: 'heading' | 'body' | 'result'
}

export interface Subtitle {
  id: string
  text: string
  marker?: string   // links to WhiteboardAction.id
}

export interface WhiteboardBlock {
  actions: WhiteboardAction[]
}

export interface WhiteboardScene {
  title: string
  clean_response: string
  subtitles: Subtitle[]
  whiteboard: WhiteboardBlock
}

/** Playback state for the ActionPlayer */
export interface PlaybackState {
  isPlaying: boolean
  currentIndex: number        // current subtitle index
  totalSubtitles: number
  // Word-level tracking for word-by-word display
  currentWordIndex: number    // current word index within current subtitle
  totalWords: number          // total words in current subtitle
  currentWord: string         // the word being spoken now
  visibleWords: string[]      // words to show (for progressive reveal)
  isFading: boolean           // true when transitioning between words
}