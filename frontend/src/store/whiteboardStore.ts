'use client'

import { create } from 'zustand'
import { Editor, createShapeId, TLShapeId } from 'tldraw'
import { ActionPlayer } from '@/components/whiteboard/ActionPlayer'
import type { WhiteboardScene, WhiteboardAction, PlaybackState } from '@/types/whiteboard-sync'
import { buildDiagramFrame, type VisualPlan } from '@/components/whiteboard/DiagramBuilder'

/* ═══════════════════════════════════════════════════════════════════
   PRE-MADE PAGES
   
   Every chat's whiteboard has exactly four named pages:
     1. Teaching    — milestone lessons, diagrams, whiteboard scenes
     2. Practice    — reserved for future practice workflows
     3. Note Taking — videos opened from chat, scraped media
     4. Scratch     — free-form user notes
   
   Pages are created lazily on first load and restored from snapshot.
   ═══════════════════════════════════════════════════════════════════ */

export const PAGES = {
  TEACHING:    'Teaching',
  PRACTICE:    'Practice',
  NOTE_TAKING: 'Note Taking',
  SCRATCH:     'Scratch',
} as const

export type PageName = (typeof PAGES)[keyof typeof PAGES]

const PAGE_ORDER: PageName[] = [
  PAGES.TEACHING,
  PAGES.PRACTICE,
  PAGES.NOTE_TAKING,
  PAGES.SCRATCH,
]

/* ═══════════════════════════════════════════════════════════════════
   A4 FRAME GRID LAYOUT
   ═══════════════════════════════════════════════════════════════════ */

const A4 = {
  WIDTH:   800,
  HEIGHT:  1100,
  GAP:     60,
  COLS:    4,
  PADDING: 40,
  ROW_H:   100,
} as const

function slotToXY(slot: number): { x: number; y: number } {
  const col = slot % A4.COLS
  const row = Math.floor(slot / A4.COLS)
  return {
    x: col * (A4.WIDTH + A4.GAP),
    y: row * (A4.HEIGHT + A4.GAP),
  }
}

function actionToLocal(pos: { x: number; y: number }): { x: number; y: number } {
  return {
    x: A4.PADDING + Math.max(0, pos.x) * 360,
    y: A4.PADDING + (pos.y + 1) * A4.ROW_H,
  }
}

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

/* ── Page helpers ─────────────────────────────────────────────────── */

/**
 * Ensure all four named pages exist.
 * On a fresh board the default "Page 1" is renamed to "Teaching".
 * Idempotent — safe to call after every snapshot load.
 */
function ensurePages(editor: Editor): void {
  const pages = editor.getPages()
  const byName = new Set(pages.map((p) => p.name))
  const hasAnyNamed = PAGE_ORDER.some((n) => byName.has(n))

  // Fresh board: rename the single default page → Teaching
  if (!hasAnyNamed && pages.length >= 1) {
    editor.renamePage(pages[0].id, PAGES.TEACHING)
    byName.add(PAGES.TEACHING)
  }

  // Create any missing pages
  for (const name of PAGE_ORDER) {
    if (!byName.has(name)) {
      editor.createPage({ name })
    }
  }
}

/** Find a page by name, returns its TLPageId or null. */
function findPage(editor: Editor, name: string) {
  return editor.getPages().find((p) => p.name === name) ?? null
}

/** Center the viewport on a specific frame with a comfortable zoom level. */
function centerOnFrame(editor: Editor, frameId: TLShapeId): void {
  try {
    editor.selectNone()
    editor.select(frameId)
    // zoomToSelection centres the camera on the selected shapes with nice padding
    try {
      editor.zoomToSelection({ duration: 400 })
    } catch {
      try { editor.zoomToSelection() } catch { /* fallback: do nothing */ }
    }
  } catch {
    // Safety net — zoom to fit everything if the above fails
    try { editor.zoomToFit({ duration: 400 }) } catch {}
  }
}

/* ── localStorage persistence ─────────────────────────────────────── */

const SNAP_KEY   = (id: string) => `wb-snap-${id}`
const SLOTS_KEY  = (id: string) => `wb-slots-${id}`
const MEDIA_KEY  = (id: string) => `wb-media-${id}`
const MCOUNT_KEY = (id: string) => `wb-mcount-${id}`

function persistSnapshot(chatId: string, snapshot: any): void {
  try {
    const json = JSON.stringify(snapshot)
    if (json.length > 4 * 1024 * 1024) {
      console.warn(`[whiteboard] Snapshot for ${chatId} too large (${(json.length / 1024 / 1024).toFixed(1)}MB) — skipping persist`)
      return
    }
    localStorage.setItem(SNAP_KEY(chatId), json)
  } catch (e) {
    console.warn('[whiteboard] persist snapshot failed:', e)
  }
}

function loadPersistedSnapshot(chatId: string): any | null {
  try {
    const raw = localStorage.getItem(SNAP_KEY(chatId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function removePersistedData(chatId: string): void {
  try {
    localStorage.removeItem(SNAP_KEY(chatId))
    localStorage.removeItem(SLOTS_KEY(chatId))
    localStorage.removeItem(MEDIA_KEY(chatId))
    localStorage.removeItem(MCOUNT_KEY(chatId))
  } catch {}
}

/** Slot counts are now per-page: { Teaching: 2, Practice: 0, … } */
function persistSlotCounts(chatId: string, counts: Record<string, number>): void {
  try { localStorage.setItem(SLOTS_KEY(chatId), JSON.stringify(counts)) } catch {}
}

function loadPersistedSlotCounts(chatId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(SLOTS_KEY(chatId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    // Backwards compat: old format was a single number
    if (typeof parsed === 'number') return { [PAGES.TEACHING]: parsed }
    return parsed
  } catch { return {} }
}

function persistPlacedMedia(chatId: string, media: Record<string, boolean>, count: number): void {
  try {
    localStorage.setItem(MEDIA_KEY(chatId), JSON.stringify(media))
    localStorage.setItem(MCOUNT_KEY(chatId), String(count))
  } catch {}
}

function loadPersistedMedia(chatId: string): { placedMedia: Record<string, boolean>; mediaCount: number } {
  try {
    const raw = localStorage.getItem(MEDIA_KEY(chatId))
    const cRaw = localStorage.getItem(MCOUNT_KEY(chatId))
    return {
      placedMedia: raw ? JSON.parse(raw) : {},
      mediaCount: cRaw ? parseInt(cRaw, 10) || 0 : 0,
    }
  } catch { return { placedMedia: {}, mediaCount: 0 } }
}

/* ── Slot-count key helper (per chat + per page) ──────────────────── */

function slotKey(chatId: string, pageName: string): string {
  return `${chatId}:${pageName}`
}

/* ── Store interface ──────────────────────────────────────────────── */

interface WhiteboardStore {
  editor: Editor | null
  currentChatId: string
  currentSubtitle: string
  playbackState: PlaybackState
  activePlayer: ActionPlayer | null

  snapshots: Record<string, any>
  slotCounts: Record<string, number>   // keyed by "chatId:pageName"
  placedMedia: Record<string, boolean>
  mediaCount: number

  setEditor: (editor: Editor) => void
  saveSnapshot: (chatId: string) => void
  loadSnapshot: (chatId: string) => void
  clearWhiteboard: () => void
  clearPlacedMedia: () => void
  switchToPage: (pageName: string) => void
  getCurrentPageName: () => string
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
    try { editor.user.updateUserPreferences({ isSnapMode: true }) } catch {}
    set({ editor })
  },

  /* ── Snapshot persistence ────────────────────────────────────── */

  saveSnapshot: (chatId) => {
    const { editor } = get()
    if (!editor || !chatId) return
    try {
      const snapshot = editor.store.getStoreSnapshot()
      set((s) => ({ snapshots: { ...s.snapshots, [chatId]: snapshot } }))
      persistSnapshot(chatId, snapshot)

      // Persist per-page slot counts for this chat
      const allSlots = get().slotCounts
      const chatSlots: Record<string, number> = {}
      const prefix = chatId + ':'
      for (const [k, v] of Object.entries(allSlots)) {
        if (k.startsWith(prefix)) chatSlots[k.slice(prefix.length)] = v
      }
      persistSlotCounts(chatId, chatSlots)
      persistPlacedMedia(chatId, get().placedMedia, get().mediaCount)
    } catch (e) {
      console.warn('[whiteboard] saveSnapshot failed:', e)
    }
  },

  loadSnapshot: (chatId) => {
    const { editor, snapshots } = get()
    if (!editor || !chatId) return
    set({ currentChatId: chatId })

    // 1. Try in-memory, then localStorage
    let snap = snapshots[chatId]
    if (!snap) {
      snap = loadPersistedSnapshot(chatId)
      if (snap) set((s) => ({ snapshots: { ...s.snapshots, [chatId]: snap } }))
    }

    if (snap) {
      try {
        editor.store.loadSnapshot(snap)
      } catch (e) {
        console.warn('[whiteboard] loadSnapshot failed:', e)
      }
    } else {
      // No snapshot → clear all shapes on every existing page
      const currentPageId = editor.getCurrentPageId()
      for (const page of editor.getPages()) {
        editor.setCurrentPage(page.id)
        const ids = [...editor.getCurrentPageShapeIds()]
        if (ids.length > 0) editor.deleteShapes(ids)
      }
      // Restore to the page we were on (or first page)
      try { editor.setCurrentPage(currentPageId) } catch {}
    }

    // 2. Ensure the four named pages exist
    ensurePages(editor)

    // 3. Switch to Teaching page by default
    const teachingPage = findPage(editor, PAGES.TEACHING)
    if (teachingPage) editor.setCurrentPage(teachingPage.id)

    // 4. Restore per-page slot counts from localStorage
    const persisted = loadPersistedSlotCounts(chatId)
    const slotUpdates: Record<string, number> = {}
    for (const pageName of PAGE_ORDER) {
      const key = slotKey(chatId, pageName)
      // Count actual frames on this page as a fallback
      const page = findPage(editor, pageName)
      let frameCount = 0
      if (page) {
        const prevPage = editor.getCurrentPageId()
        editor.setCurrentPage(page.id)
        frameCount = [...editor.getCurrentPageShapeIds()]
          .map((id) => editor.getShape(id))
          .filter((s) => s?.type === 'frame').length
        editor.setCurrentPage(prevPage)
      }
      slotUpdates[key] = Math.max(persisted[pageName] || 0, frameCount)
    }

    // Restore to Teaching after counting
    if (teachingPage) editor.setCurrentPage(teachingPage.id)

    // 5. Restore media tracking
    const { placedMedia, mediaCount } = loadPersistedMedia(chatId)

    set((s) => ({
      slotCounts: { ...s.slotCounts, ...slotUpdates },
      placedMedia,
      mediaCount,
    }))
  },

  /* ── Page management ─────────────────────────────────────────── */

  switchToPage: (pageName: string) => {
    const { editor } = get()
    if (!editor) return
    const page = findPage(editor, pageName)
    if (page) {
      editor.setCurrentPage(page.id)
    }
  },

  getCurrentPageName: () => {
    const { editor } = get()
    if (!editor) return PAGES.TEACHING
    const current = editor.getCurrentPage()
    return current?.name ?? PAGES.TEACHING
  },

  /* ── Clear ───────────────────────────────────────────────────── */

  clearWhiteboard: () => {
    const { editor, currentChatId } = get()
    if (!editor) return

    // Clear shapes on ALL pages
    const currentPageId = editor.getCurrentPageId()
    for (const page of editor.getPages()) {
      editor.setCurrentPage(page.id)
      const ids = [...editor.getCurrentPageShapeIds()]
      if (ids.length > 0) editor.deleteShapes(ids)
    }
    try { editor.setCurrentPage(currentPageId) } catch {}

    if (currentChatId) {
      // Reset all slot counts for this chat
      const slotUpdates: Record<string, number> = {}
      for (const pageName of PAGE_ORDER) {
        slotUpdates[slotKey(currentChatId, pageName)] = 0
      }
      set((s) => ({
        slotCounts: { ...s.slotCounts, ...slotUpdates },
        mediaCount: 0,
        placedMedia: {},
      }))
      removePersistedData(currentChatId)
    }
  },

  clearPlacedMedia: () => set({ placedMedia: {}, mediaCount: 0 }),

  /* ── Build visual plan (Teaching page) ───────────────────────── */

  buildVisualPlan: (plan) => {
    const { editor, currentChatId, slotCounts } = get()
    if (!editor || !plan?.visuals?.length) return

    // Switch to Teaching page
    const teachingPage = findPage(editor, PAGES.TEACHING)
    if (teachingPage) editor.setCurrentPage(teachingPage.id)

    const sk = slotKey(currentChatId, PAGES.TEACHING)
    const slot = slotCounts[sk] || 0

    try {
      const { frameId, shapeIds } = buildDiagramFrame(editor, plan, slot)

      set((s) => ({
        slotCounts: { ...s.slotCounts, [sk]: slot + 1 },
      }))

      // Auto-save so diagram persists
      setTimeout(() => get().saveSnapshot(currentChatId), 500)

      // Auto-center on the new frame
      centerOnFrame(editor, frameId)

      console.log(`[whiteboard] Built visual plan on Teaching page: ${plan.topic} (${shapeIds.length} shapes)`)
    } catch (e) {
      console.warn('[whiteboard] buildVisualPlan failed:', e)
    }
  },

  /* ── Scene playback (Teaching page) ──────────────────────────── */

  playScene: (scene, speakFn) => {
    const { editor, currentChatId, slotCounts } = get()
    if (!editor) return

    const prev = get().activePlayer
    if (prev) prev.stop()

    // Switch to Teaching page
    const teachingPage = findPage(editor, PAGES.TEACHING)
    if (teachingPage) editor.setCurrentPage(teachingPage.id)

    // 1. Allocate A4 slot on Teaching page
    const sk = slotKey(currentChatId, PAGES.TEACHING)
    const slot = slotCounts[sk] || 0
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

    set((s) => ({
      slotCounts: { ...s.slotCounts, [sk]: slot + 1 },
    }))

    // Auto-center on the new frame immediately
    centerOnFrame(editor, frameId)

    // 2. Build ActionPlayer
    const player = new ActionPlayer(scene, {
      onSubtitle: (text) => set({ currentSubtitle: text }),
      onPlaybackState: (ps) => set({ playbackState: ps }),

      onWhiteboardAction: (action) => {
        const local = actionToLocal(action.position)
        const isHeading = action.style === 'heading'
        const isResult  = action.style === 'result'
        const fontSize: string = isHeading ? 'xl' : isResult ? 'l' : 'm'

        const shapeId = createShapeId()
        const shapeProps: Record<string, any> = {
          text: action.text,
          size: fontSize,
          font: 'sans',
          autoSize: false,
          w: A4.WIDTH - 2 * A4.PADDING,
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
        // Auto-save after scene playback
        setTimeout(() => get().saveSnapshot(get().currentChatId), 500)
        // Re-center on the completed frame
        centerOnFrame(editor, frameId)
      },
    })

    set({ activePlayer: player })
    player.play()
  },

  /* ── Media placement (Note Taking page for videos) ───────────── */

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

    // Search all pages for the media shape
    const allPages = editor.getPages()
    const originalPageId = editor.getCurrentPageId()

    for (const page of allPages) {
      editor.setCurrentPage(page.id)
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
    }

    // Not found — restore original page, then place it
    editor.setCurrentPage(originalPageId)
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