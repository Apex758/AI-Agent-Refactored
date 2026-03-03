'use client'

import { create } from 'zustand'
import { Editor, createShapeId, TLShapeId } from 'tldraw'
import { ActionPlayer } from '@/components/whiteboard/ActionPlayer'
import type { WhiteboardScene, WhiteboardAction, PlaybackState } from '@/types/whiteboard-sync'
import { buildDiagramFrame, type VisualPlan } from '@/components/whiteboard/DiagramBuilder'

/* ═══════════════════════════════════════════════════════════════════
   A4 FRAME GRID LAYOUT
   
   Each scene/content block gets its own A4-sized frame.
   Frames are laid out in a 4-column grid:
   
   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
   │  0   │ │  1   │ │  2   │ │  3   │  ← Row 0
   └──────┘ └──────┘ └──────┘ └──────┘
   ┌──────┐ ┌──────┐
   │  4   │ │  5   │ ...                 ← Row 1
   └──────┘ └──────┘
   
   Frames are movable by the user. TLDraw's snap mode aligns edges.
   Content shapes live INSIDE frames (parentId = frameId).
   ═══════════════════════════════════════════════════════════════════ */

const A4 = {
  WIDTH:   800,
  HEIGHT:  1100,
  GAP:     60,    // space between frames
  COLS:    4,     // frames per row
  PADDING: 40,    // inner padding within frame
  ROW_H:   100,   // vertical step per content row inside a frame
} as const

/** Convert a grid slot index (0, 1, 2…) → top-left pixel position */
function slotToXY(slot: number): { x: number; y: number } {
  const col = slot % A4.COLS
  const row = Math.floor(slot / A4.COLS)
  return {
    x: col * (A4.WIDTH + A4.GAP),
    y: row * (A4.HEIGHT + A4.GAP),
  }
}

/**
 * Map an action's grid position to local pixel coords inside a frame.
 * Action positions:  x = column (0–1),  y = row (−1 = title, 0+ = content)
 */
function actionToLocal(pos: { x: number; y: number }): { x: number; y: number } {
  return {
    x: A4.PADDING + Math.max(0, pos.x) * 360,
    y: A4.PADDING + (pos.y + 1) * A4.ROW_H, // +1 so y=-1 → top of frame
  }
}

/** Media goes to the right of the A4 grid */
const MEDIA_AREA = {
  X: A4.COLS * (A4.WIDTH + A4.GAP) + 120,
  Y: 0,
  STEP: 340,
}

const EMPTY_PLAYBACK: PlaybackState = {
  isPlaying: false,
  currentIndex: 0,
  totalSubtitles: 0,
  currentWordIndex: 0,
  totalWords: 0,
  currentWord: '',
  visibleWords: [],
  isFading: false,
}

/* ── Store interface ──────────────────────────────────────────────── */

interface WhiteboardStore {
  // State
  editor: Editor | null
  currentChatId: string
  currentSubtitle: string
  playbackState: PlaybackState
  activePlayer: ActionPlayer | null

  // Persistence — keyed by chatId
  snapshots: Record<string, any>
  slotCounts: Record<string, number>   // how many A4 frames per chat
  placedMedia: Record<string, boolean> // dedup keys for placed media
  mediaCount: number                   // vertical counter for media stack

  // Public actions
  setEditor: (editor: Editor) => void
  saveSnapshot: (chatId: string) => void
  loadSnapshot: (chatId: string) => void
  clearWhiteboard: () => void
  clearPlacedMedia: () => void
  buildVisualPlan: (plan: VisualPlan) => void
  playScene: (scene: WhiteboardScene, speakFn: (text: string) => Promise<void>) => void
  placeYouTubeVideos: (ids: string[]) => void
  placeScrapedMedia: (images: string[], videos: string[]) => void
  focusOrPlaceMedia: (key: string) => void
  exportAsImage: () => Promise<Blob | null>
}

/* ── Zustand store ────────────────────────────────────────────────── */

export const useWhiteboardStore = create<WhiteboardStore>((set, get) => ({
  editor: null,
  currentChatId: '',
  currentSubtitle: '',
  playbackState: EMPTY_PLAYBACK,
  activePlayer: null,
  snapshots: {},
  slotCounts: {},
  placedMedia: {},
  mediaCount: 0,

  /* ── Editor lifecycle ────────────────────────────────────────── */

  setEditor: (editor) => {
    // Enable object-snap so A4 frames snap-align to each other's edges
    try {
      editor.user.updateUserPreferences({ isSnapMode: true })
    } catch {
      // Older TLDraw versions may not have this
    }
    set({ editor })
  },

  saveSnapshot: (chatId) => {
    const { editor } = get()
    if (!editor || !chatId) return
    try {
      const snapshot = editor.store.getStoreSnapshot()
      set((s) => ({ snapshots: { ...s.snapshots, [chatId]: snapshot } }))
    } catch (e) {
      console.warn('[whiteboard] saveSnapshot failed:', e)
    }
  },

  loadSnapshot: (chatId) => {
    const { editor, snapshots } = get()
    if (!editor || !chatId) return

    set({ currentChatId: chatId })

    const snap = snapshots[chatId]
    if (snap) {
      try {
        editor.store.loadSnapshot(snap)
      } catch (e) {
        console.warn('[whiteboard] loadSnapshot failed:', e)
      }
    }

    // Derive slot count from existing frame shapes on the page
    const frameCount = [...editor.getCurrentPageShapeIds()]
      .map((id) => editor.getShape(id))
      .filter((s) => s?.type === 'frame')
      .length

    set((s) => ({
      slotCounts: { ...s.slotCounts, [chatId]: frameCount },
    }))
  },

  clearWhiteboard: () => {
    const { editor, currentChatId } = get()
    if (!editor) return
    const ids = [...editor.getCurrentPageShapeIds()]
    if (ids.length > 0) editor.deleteShapes(ids)
    if (currentChatId) {
      set((s) => ({
        slotCounts: { ...s.slotCounts, [currentChatId]: 0 },
        mediaCount: 0,
      }))
    }
  },

  clearPlacedMedia: () => set({ placedMedia: {}, mediaCount: 0 }),

  buildVisualPlan: (plan) => {
    const { editor, currentChatId, slotCounts } = get()
    if (!editor || !plan?.visuals?.length) return

    const slot = slotCounts[currentChatId] || 0

    try {
      const { frameId, shapeIds } = buildDiagramFrame(editor, plan, slot)

      // Advance slot counter
      set((s) => ({
        slotCounts: { ...s.slotCounts, [currentChatId]: slot + 1 },
      }))

      // Zoom to show the new diagram frame
      try {
        editor.zoomToFit({ duration: 400 })
      } catch {
        try { editor.zoomToFit() } catch {}
      }

      console.log(`[whiteboard] Built visual plan: ${plan.topic} (${shapeIds.length} shapes)`)
    } catch (e) {
      console.warn('[whiteboard] buildVisualPlan failed:', e)
    }
  },

  /* ══════════════════════════════════════════════════════════════
     A4 FRAME SCENE PLAYBACK
     
     Each playScene call:
     1. Allocates the next A4 slot in the grid
     2. Creates a TLDraw "frame" shape at that slot
     3. ActionPlayer places content shapes INSIDE the frame
     4. Content uses parentId so it moves with the frame
     ══════════════════════════════════════════════════════════════ */

  playScene: (scene, speakFn) => {
    const { editor, currentChatId, slotCounts } = get()
    if (!editor) return

    // Stop any active playback
    const prev = get().activePlayer
    if (prev) prev.stop()

    // ── 1. Allocate A4 slot & create frame ───────────────────
    const slot = slotCounts[currentChatId] || 0
    const pos = slotToXY(slot)
    const frameId = createShapeId()

    editor.createShape({
      id: frameId,
      type: 'frame',
      x: pos.x,
      y: pos.y,
      props: {
        w: A4.WIDTH,
        h: A4.HEIGHT,
        name: scene.title || `Scene ${slot + 1}`,
      },
    })

    // Advance slot
    set((s) => ({
      slotCounts: { ...s.slotCounts, [currentChatId]: slot + 1 },
    }))

    // ── 2. Build ActionPlayer with frame-aware callbacks ─────
    const player = new ActionPlayer(scene, {
      onSubtitle: (text) => set({ currentSubtitle: text }),
      onPlaybackState: (ps) => set({ playbackState: ps }),

      onWhiteboardAction: (action) => {
        const local = actionToLocal(action.position)
        const isHeading = action.style === 'heading'
        const isResult  = action.style === 'result'
        const fontSize: string = isHeading ? 'xl' : isResult ? 'l' : 'm'

        const shapeId = createShapeId()

        // ALL text inside frames uses autoSize:false + width for proper wrapping.
        // This ensures content reflows when the user adjusts the frame.
        const shapeProps: Record<string, any> = {
          text: action.text,
          size: fontSize,
          font: 'sans',
          // Always wrap: set width to fill the frame minus padding
          autoSize: false,
          w: A4.WIDTH - 2 * A4.PADDING,
        }

        // Headings get slightly narrower width and are still non-autoSize
        // so they wrap if the frame is made smaller
        if (isHeading) {
          shapeProps.w = A4.WIDTH - 2 * A4.PADDING
        }

        editor.createShape({
          id: shapeId,
          type: 'text',
          parentId: frameId,
          x: local.x,
          y: local.y,
          props: shapeProps,
        })
      },

      onSpeak: speakFn,

      onComplete: () => {
        set({ activePlayer: null })
        // Pan camera to show the new frame nicely
        try {
          editor.zoomToFit({ duration: 400 })
        } catch {
          // Some TLDraw versions use different API
          try { editor.zoomToFit() } catch {}
        }
      },
    })

    set({ activePlayer: player })
    player.play()
  },

  /* ── Media placement (right of A4 grid) ──────────────────── */

  placeYouTubeVideos: (ids) => {
    const { editor, placedMedia } = get()
    if (!editor) return
    let count = get().mediaCount
    const updates: Record<string, boolean> = {}

    for (const id of ids) {
      const key = `yt-${id}`
      if (placedMedia[key]) continue

      try {
        editor.createShape({
          id: createShapeId(),
          type: 'youtube' as any,
          x: MEDIA_AREA.X,
          y: MEDIA_AREA.Y + count * MEDIA_AREA.STEP,
          props: { videoId: id, w: 320, h: 200 },
        })
      } catch {
        // YouTubeShapeUtil not registered — place as text link
        editor.createShape({
          id: createShapeId(),
          type: 'text',
          x: MEDIA_AREA.X,
          y: MEDIA_AREA.Y + count * MEDIA_AREA.STEP,
          props: { text: `▶ youtube.com/watch?v=${id}`, size: 's', autoSize: true },
        })
      }
      updates[key] = true
      count++
    }

    if (Object.keys(updates).length > 0) {
      set((s) => ({
        placedMedia: { ...s.placedMedia, ...updates },
        mediaCount: count,
      }))
    }
  },

  placeScrapedMedia: (images, _videos) => {
    const { editor, placedMedia } = get()
    if (!editor) return
    let count = get().mediaCount
    const updates: Record<string, boolean> = {}

    for (const url of images) {
      const key = `img-${url}`
      if (placedMedia[key]) continue

      editor.createShape({
        id: createShapeId(),
        type: 'text',
        x: MEDIA_AREA.X,
        y: MEDIA_AREA.Y + count * MEDIA_AREA.STEP,
        props: { text: `🖼 ${url}`, size: 's', autoSize: true },
      })
      updates[key] = true
      count++
    }

    if (Object.keys(updates).length > 0) {
      set((s) => ({
        placedMedia: { ...s.placedMedia, ...updates },
        mediaCount: count,
      }))
    }
  },

  focusOrPlaceMedia: (key) => {
    const { editor } = get()
    if (!editor) return

    // Try to find an existing shape for this media
    for (const id of editor.getCurrentPageShapeIds()) {
      const shape = editor.getShape(id) as any
      if (!shape) continue

      if (key.startsWith('yt-') && shape.type === 'youtube' && shape.props?.videoId === key.slice(3)) {
        editor.select(shape.id)
        try { editor.zoomToSelection({ duration: 300 }) } catch {}
        return
      }
      if (key.startsWith('img-') && shape.type === 'text' && shape.props?.text?.includes(key.slice(4))) {
        editor.select(shape.id)
        try { editor.zoomToSelection({ duration: 300 }) } catch {}
        return
      }
    }

    // Not found — place it
    if (key.startsWith('yt-')) {
      get().placeYouTubeVideos([key.slice(3)])
    } else if (key.startsWith('img-')) {
      get().placeScrapedMedia([key.slice(4)], [])
    }
  },

  /* ── Export ──────────────────────────────────────────────────── */

  exportAsImage: async () => {
    const { editor } = get()
    if (!editor) return null

    const shapeIds = [...editor.getCurrentPageShapeIds()]
    if (shapeIds.length === 0) return null

    try {
      // TLDraw v2.x export
      const svg = await editor.getSvg(shapeIds)
      if (!svg) return null

      const svgStr = new XMLSerializer().serializeToString(svg)
      const canvas = document.createElement('canvas')
      canvas.width = 1920
      canvas.height = 1080
      const ctx = canvas.getContext('2d')!

      return new Promise<Blob | null>((resolve) => {
        const img = new Image()
        img.onload = () => {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, 1920, 1080)
          const scale = Math.min(1920 / img.width, 1080 / img.height, 1)
          const dx = (1920 - img.width * scale) / 2
          const dy = (1080 - img.height * scale) / 2
          ctx.drawImage(img, dx, dy, img.width * scale, img.height * scale)
          canvas.toBlob(resolve, 'image/png')
        }
        img.onerror = () => resolve(null)
        img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgStr)))}`
      })
    } catch (e) {
      console.warn('[whiteboard] export failed:', e)
      return null
    }
  },
}))