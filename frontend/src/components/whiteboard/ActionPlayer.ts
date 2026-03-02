/**
 * ActionPlayer — Sequential playback engine for whiteboard scene sync.
 *
 * Flow per subtitle:
 *   1. Display subtitle text in overlay
 *   2. Fire matching whiteboard action (TLDraw shape creation)
 *   3. Speak subtitle via TTS
 *   4. Wait for speech to finish OR minimum display duration
 *   5. Advance to next subtitle
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

  constructor(scene: WhiteboardScene, callbacks: ActionPlayerCallbacks) {
    this.scene = scene
    this.callbacks = callbacks

    // Build lookup: marker id → action
    this.actionMap = new Map()
    for (const action of scene.whiteboard.actions) {
      this.actionMap.set(action.id, action)
    }
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

    // Play each subtitle sequentially
    for (let i = 0; i < this.scene.subtitles.length; i++) {
      if (this.stopped) break

      this.currentIndex = i
      const subtitle = this.scene.subtitles[i]

      // Update playback state
      this.callbacks.onPlaybackState({
        isPlaying: true,
        currentIndex: i,
        totalSubtitles: this.scene.subtitles.length,
      })

      // Show subtitle text
      this.callbacks.onSubtitle(subtitle.text)

      // Fire matching whiteboard action
      if (subtitle.marker) {
        const action = this.actionMap.get(subtitle.marker)
        if (action) {
          this.callbacks.onWhiteboardAction(action)
        }
      }

      // Speak + wait for minimum display time
      const minDuration = Math.max(subtitle.text.length * 55, 1200) // ms
      await Promise.all([
        this.callbacks.onSpeak(subtitle.text).catch(() => {}),
        this.delay(minDuration),
      ])

      // Small pause between subtitles
      if (!this.stopped && i < this.scene.subtitles.length - 1) {
        await this.delay(400)
      }
    }

    // Done
    if (!this.stopped) {
      this.callbacks.onSubtitle('')
      this.callbacks.onPlaybackState({
        isPlaying: false,
        currentIndex: this.scene.subtitles.length - 1,
        totalSubtitles: this.scene.subtitles.length,
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