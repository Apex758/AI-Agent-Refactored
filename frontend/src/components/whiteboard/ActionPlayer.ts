/**
 * ActionPlayer — Sequential playback engine for whiteboard scene sync.
 *
 * Flow per subtitle:
 *   1. Display the full subtitle text (one line at a time)
 *   2. Fire matching whiteboard action (TLDraw shape creation)
 *   3. Speak subtitle via TTS
 *   4. Wait for speech to finish OR minimum display duration
 *   5. Advance to next subtitle
 */

import { cleanForTTS, cleanForSubtitle } from '@/utils/textCleaner'
import type { WhiteboardScene, Subtitle, WhiteboardAction, PlaybackState } from '@/types/whiteboard-sync'

export interface ActionPlayerCallbacks {
  /** Called when current subtitle text changes (one line at a time) */
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

  constructor(scene: WhiteboardScene, callbacks: ActionPlayerCallbacks) {
    this.scene = scene
    this.callbacks = callbacks

    // Build lookup: marker id → action
    this.actionMap = new Map()
    for (const action of scene.whiteboard.actions) {
      this.actionMap.set(action.id, action)
    }
  }

  /** Start sequential playback — one subtitle at a time */
  async play(): Promise<void> {
    this.stopped = false
    this.currentIndex = 0


    // First, place the title on the board
    if (this.scene.title) {
      this.callbacks.onWhiteboardAction({
        id: 'scene-title',
        type: 'create_text',
        text: cleanForSubtitle(this.scene.title),
        position: { x: 0, y: -1 },
        style: 'heading',
      })
    }

    // Fire any whiteboard actions that don't have matching subtitles
    // (e.g., milestone listing placed at scene start)
    const markedActionIds = new Set(
      this.scene.subtitles
        .filter(s => s.marker)
        .map(s => s.marker!)
    )
    for (const action of this.scene.whiteboard.actions) {
      if (!markedActionIds.has(action.id)) {
        this.callbacks.onWhiteboardAction(action)
      }
    }

    // Small pause to let initial shapes render
    if (!this.stopped) await this.delay(400)

    // Play each subtitle one at a time
    for (let i = 0; i < this.scene.subtitles.length; i++) {
      if (this.stopped) break

      this.currentIndex = i
      const subtitle = this.scene.subtitles[i]
      const cleanText = cleanForSubtitle(subtitle.text)

      // Update playback state
      this.callbacks.onPlaybackState({
        isPlaying: true,
        currentIndex: i,
        totalSubtitles: this.scene.subtitles.length,
        currentWordIndex: 0,
        totalWords: 0,
        currentWord: '',
        visibleWords: [],
        isFading: false,
      })

      // Show the full subtitle line
      this.callbacks.onSubtitle(cleanText)

      // Fire matching whiteboard action
      if (subtitle.marker) {
        const action = this.actionMap.get(subtitle.marker)
        if (action) {
          this.callbacks.onWhiteboardAction(action)
        }
      }

      // Speak the subtitle and wait for completion
      if (!this.stopped && cleanText) {
        const cleanTTS = cleanForTTS(subtitle.text)
        // Minimum display time of 2s even if TTS finishes faster
        const minDisplayPromise = this.delay(2000)
        const speakPromise = this.callbacks.onSpeak(cleanTTS).catch(() => {})
        await Promise.all([minDisplayPromise, speakPromise])
      }

      // Brief pause between subtitles for visual breathing room
      if (!this.stopped && i < this.scene.subtitles.length - 1) {
        // Fade out current subtitle
        this.callbacks.onPlaybackState({
          isPlaying: true,
          currentIndex: i,
          totalSubtitles: this.scene.subtitles.length,
          currentWordIndex: 0,
          totalWords: 0,
          currentWord: '',
          visibleWords: [],
          isFading: true,
        })
        await this.delay(300)
      }
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