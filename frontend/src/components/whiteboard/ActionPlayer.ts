/**
 * ActionPlayer — Sequential playback engine for whiteboard scene sync.
 *
 * Flow per subtitle:
 *   1. Split subtitle into words
 *   2. Display words one-by-one with fade transitions
 *   3. Fire matching whiteboard action (TLDraw shape creation)
 *   4. Speak subtitle via TTS
 *   5. Wait for speech to finish OR minimum display duration
 *   6. Advance to next subtitle
 */

import type { WhiteboardScene, Subtitle, WhiteboardAction, PlaybackState } from '@/types/whiteboard-sync'

export interface ActionPlayerCallbacks {
  /** Called when current subtitle text changes */
  onSubtitle: (text: string) => void
  /** Called when playback state changes */
  onPlaybackState: (state: PlaybackState) => void
  /** Called to create a TLDraw shape */
  onWhiteboardAction: (action: WhiteboardAction) => void
  /** Called to speak text via TTS — returns a Promise that resolves when speech ends */
  onSpeak: (text: string) => Promise<void>
  /** Called when the entire scene finishes */
  onComplete: () => void
}

export class ActionPlayer {
  private scene: WhiteboardScene
  private callbacks: ActionPlayerCallbacks
  private currentIndex = 0
  private stopped = false
  private actionMap: Map<string, WhiteboardAction>
  // Word-level tracking
  private currentWordIndex = 0
  private words: string[] = []

  constructor(scene: WhiteboardScene, callbacks: ActionPlayerCallbacks) {
    this.scene = scene
    this.callbacks = callbacks

    // Build lookup: marker id → action
    this.actionMap = new Map()
    for (const action of scene.whiteboard.actions) {
      this.actionMap.set(action.id, action)
    }
  }

  /** Split text into words, preserving punctuation */
  private splitIntoWords(text: string): string[] {
    return text.split(/\s+/).filter(w => w.length > 0)
  }

  /** Start sequential playback */
  async play(): Promise<void> {
    this.stopped = false
    this.currentIndex = 0

    // First, place the title on the board
    if (this.scene.title) {
      this.callbacks.onWhiteboardAction({
        id: 'scene-title',
        type: 'create_text',
        text: this.scene.title,
        position: { x: 0, y: -1 },  // above the grid
        style: 'heading',
      })
    }

    // Use full clean_response for word-by-word display if available
    const fullText = this.scene.clean_response || this.scene.subtitles.map(s => s.text).join(' ')
    this.words = this.splitIntoWords(fullText)
    this.currentWordIndex = 0

    // Update playback state with word info for the full text
    this.callbacks.onPlaybackState({
      isPlaying: true,
      currentIndex: 0,
      totalSubtitles: this.scene.subtitles.length,
      currentWordIndex: 0,
      totalWords: this.words.length,
      currentWord: this.words[0] || '',
      visibleWords: [],
      isFading: false,
    })

    // Play each subtitle to trigger whiteboard actions
    for (let i = 0; i < this.scene.subtitles.length; i++) {
      if (this.stopped) break

      this.currentIndex = i
      const subtitle = this.scene.subtitles[i]

      // Fire matching whiteboard action
      if (subtitle.marker) {
        const action = this.actionMap.get(subtitle.marker)
        if (action) {
          this.callbacks.onWhiteboardAction(action)
        }
      }

      // Small pause between whiteboard actions
      if (!this.stopped && i < this.scene.subtitles.length - 1) {
        await this.delay(300)
      }
    }

    // Now speak the full text with word-by-word display
    if (!this.stopped && this.words.length > 0) {
      await this.speakWithWordDisplay(fullText)
    }

    // Done
    if (!this.stopped) {
      this.callbacks.onSubtitle('')
      this.callbacks.onPlaybackState({
        isPlaying: false,
        currentIndex: this.scene.subtitles.length - 1,
        totalSubtitles: this.scene.subtitles.length,
        currentWordIndex: 0,
        totalWords: 0,
        currentWord: '',
        visibleWords: [],
        isFading: false,
      })
      this.callbacks.onComplete()
    }
  }

  /** Speak text while displaying words one-by-one with fade transitions */
  private async speakWithWordDisplay(text: string): Promise<void> {
    const words = this.splitIntoWords(text)
    if (words.length === 0) return

    // Calculate timing based on word count and typical speech rate
    // Average speech rate is ~150 words per minute = 400ms per word
    const wordDisplayDuration = 400 // ms per word
    
    // Start TTS in the background
    const ttsPromise = this.callbacks.onSpeak(text).catch(() => {})
    
    // Display words one by one while TTS plays
    for (let i = 0; i < words.length; i++) {
      if (this.stopped) break

      const word = words[i]
      const visibleSoFar = words.slice(0, i + 1)
      
      // Trigger fade out for previous word
      this.callbacks.onPlaybackState({
        isPlaying: true,
        currentIndex: this.currentIndex,
        totalSubtitles: this.scene.subtitles.length,
        currentWordIndex: i,
        totalWords: words.length,
        currentWord: word,
        visibleWords: visibleSoFar,
        isFading: i > 0, // fade when transitioning
      })
      
      // Update subtitle display
      this.callbacks.onSubtitle(visibleSoFar.join(' '))

      // Wait for word display duration
      await this.delay(wordDisplayDuration)
      
      // Clear fade state
      if (!this.stopped) {
        this.callbacks.onPlaybackState({
          isPlaying: true,
          currentIndex: this.currentIndex,
          totalSubtitles: this.scene.subtitles.length,
          currentWordIndex: i,
          totalWords: words.length,
          currentWord: word,
          visibleWords: visibleSoFar,
          isFading: false,
        })
      }
    }
    
    // Wait for TTS to finish (in case it's still playing)
    await ttsPromise
  }

  /** Stop playback */
  stop(): void {
    this.stopped = true
    this.callbacks.onSubtitle('')
    this.callbacks.onPlaybackState({
      isPlaying: false,
      currentIndex: this.currentIndex,
      totalSubtitles: this.scene.subtitles.length,
      currentWordIndex: 0,
      totalWords: 0,
      currentWord: '',
      visibleWords: [],
      isFading: false,
    })
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      // Check stopped state periodically
      const check = setInterval(() => {
        if (this.stopped) {
          clearTimeout(timer)
          clearInterval(check)
          resolve()
        }
      }, 100)
      setTimeout(() => clearInterval(check), ms + 100)
    })
  }
}