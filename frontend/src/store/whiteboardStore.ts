import { create } from 'zustand'
import type { Editor } from 'tldraw'
import { createShapeId } from 'tldraw'
import type { ScenePlan } from '@/components/whiteboard/types'
import type { WhiteboardScene, WhiteboardAction, PlaybackState } from '@/types/whiteboard-sync'
import { ActionPlayer } from '@/components/whiteboard/ActionPlayer'

interface WhiteboardStore {
  /** TLDraw snapshots keyed by chatId */
  snapshots: Record<string, any>
  /** Current editor instance */
  editorRef: Editor | null

  // Playback state for subtitles
  currentSubtitle: string
  playbackState: PlaybackState

  setEditor: (editor: Editor | null) => void
  saveSnapshot: (chatId: string) => void
  loadSnapshot: (chatId: string) => void
  clearWhiteboard: () => void
  exportAsImage: () => Promise<Blob | null>
  presentOnBoard: (scenePlan: ScenePlan) => void
  placeScrapedMedia: (images: string[], videoIds: string[]) => void
  placeYouTubeVideos: (videoIds: string[]) => void
  placedMediaIds: string[]  // Track already-placed media to avoid duplicates
  clearPlacedMedia: () => void
  focusOrPlaceMedia: (key: string) => void
  playScene: (scene: WhiteboardScene, onSpeak: (text: string) => Promise<void>) => void
  stopPlayback: () => void

   
}

let currentPlayer: ActionPlayer | null = null

export const useWhiteboardStore = create<WhiteboardStore>((set, get) => ({
  snapshots: {},
  editorRef: null,
  placedMediaIds: [],
  currentSubtitle: '',
  playbackState: {
    isPlaying: false,
    currentIndex: 0,
    totalSubtitles: 0,
  },

  setEditor: (editor) => set({ editorRef: editor }),

  saveSnapshot: (chatId: string) => {
    const { editorRef } = get()
    if (!editorRef || !chatId) return
    try {
      const snapshot = editorRef.store.getStoreSnapshot()
      set((s) => ({
        snapshots: { ...s.snapshots, [chatId]: snapshot },
      }))
    } catch (e) {
      console.warn('Failed to save whiteboard snapshot:', e)
    }
  },

  loadSnapshot: (chatId: string) => {
    const { editorRef, snapshots } = get()
    if (!editorRef || !chatId) return
    const snap = snapshots[chatId]
    if (snap) {
      try {
        editorRef.store.loadStoreSnapshot(snap)
      } catch (e) {
        console.warn('Failed to load whiteboard snapshot:', e)
      }
    }
  },

  clearWhiteboard: () => {
    const { editorRef } = get()
    if (!editorRef) return
    try {
      // Delete all shapes on the current page
      const shapeIds = [...editorRef.getCurrentPageShapeIds()]
      editorRef.store.remove(shapeIds)
    } catch (e) {
      console.warn('Failed to clear whiteboard:', e)
    }
  },

  exportAsImage: async () => {
    const { editorRef } = get()
    if (!editorRef) return null

    try {
      const shapeIds = [...editorRef.getCurrentPageShapeIds()]
      if (shapeIds.length === 0) return null

      // Use tldraw's built-in SVG export, then convert to PNG via canvas
      const svgResult = await editorRef.getSvgString(shapeIds, {
        background: true,
        padding: 20,
      })
      if (!svgResult) return null

      const { svg: svgString, width, height } = svgResult

      // Convert SVG string to PNG blob via off-screen canvas
      return new Promise<Blob | null>((resolve) => {
        const img = new Image()
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
        const url = URL.createObjectURL(svgBlob)

        img.onload = () => {
          const canvas = document.createElement('canvas')
          const scale = 2 // retina
          canvas.width = width * scale
          canvas.height = height * scale
          const ctx = canvas.getContext('2d')!
          ctx.scale(scale, scale)
          ctx.drawImage(img, 0, 0, width, height)
          URL.revokeObjectURL(url)

          canvas.toBlob((blob) => resolve(blob), 'image/png', 0.92)
        }

        img.onerror = () => {
          URL.revokeObjectURL(url)
          resolve(null)
        }

        img.src = url
      })
    } catch (e) {
      console.error('Export failed:', e)
      return null
    }
  },

  presentOnBoard: (scenePlan: ScenePlan) => {
    const { editorRef } = get()
    if (!editorRef) return

    const { snap = false, gridSize = 50 } = scenePlan
    const viewportBounds = editorRef.getViewportScreenBounds()

    // Convert screen bounds to page coordinates
    const topLeft = editorRef.screenToPage({ x: viewportBounds.x, y: viewportBounds.y })
    const bottomRight = editorRef.screenToPage({
      x: viewportBounds.x + viewportBounds.w,
      y: viewportBounds.y + viewportBounds.h,
    })

    const vpW = bottomRight.x - topLeft.x
    const vpH = bottomRight.y - topLeft.y

    const snapToGrid = (val: number) => {
      if (!snap) return val
      return Math.round(val / gridSize) * gridSize
    }

    for (const el of scenePlan.elements) {
      const x = snapToGrid(topLeft.x + el.x * vpW)
      const y = snapToGrid(topLeft.y + el.y * vpH)
      const w = el.w * vpW
      const h = el.h * vpH

      if (el.type === 'text') {
        editorRef.createShape({
          type: 'text',
          x,
          y,
          props: {
            text: el.text || '',
            size: el.fontSize && el.fontSize > 32 ? 'xl' : el.fontSize && el.fontSize > 20 ? 'l' : 'm',
            w,
          },
        })
      } else if (el.type === 'image' && el.url) {
        // Create an image asset + shape
        const assetId = `asset:${el.id}` as any
        editorRef.createAssets([
          {
            id: assetId,
            type: 'image',
            typeName: 'asset',
            props: {
              name: el.id,
              src: el.url,
              w,
              h,
              mimeType: 'image/png',
              isAnimated: false,
            },
            meta: {},
          },
        ])
        editorRef.createShape({
          type: 'image',
          x,
          y,
          props: {
            assetId,
            w,
            h,
          },
        })
      }
      // SVG stubbed — treat as image for now
      else if (el.type === 'svg' && el.url) {
        console.warn('SVG placement stubbed — treating as image')
      }
    }
  },

  placeScrapedMedia: (images: string[], videoIds: string[]) => {
    const { editorRef, placedMediaIds } = get()
    if (!editorRef) return
    if (images.length === 0 && videoIds.length === 0) return

    // Deduplicate per individual URL (not per batch)
    const newImages = images.filter(url => !placedMediaIds.includes(`img-${url}`))
    if (newImages.length === 0) return

    set(s => ({ placedMediaIds: [...s.placedMediaIds, ...newImages.map(url => `img-${url}`)] }))

    const viewportBounds = editorRef.getViewportScreenBounds()
    const topLeft = editorRef.screenToPage({ x: viewportBounds.x, y: viewportBounds.y })

    const IMG_W = 240
    const IMG_H = 180
    const GAP = 16

    newImages.slice(0, 6).forEach((src, i) => {
      // Deterministic IDs so focusOrPlaceMedia can locate the shape later
      const urlKey = encodeURIComponent(src).slice(0, 50)
      const shapeId = createShapeId('img-' + urlKey)
      const assetId = `asset:img-${urlKey}` as any
      editorRef.createAssets([{
        id: assetId,
        type: 'image',
        typeName: 'asset',
        props: {
          name: `img-${i}`,
          src,
          w: IMG_W,
          h: IMG_H,
          mimeType: 'image/jpeg',
          isAnimated: false,
        },
        meta: {},
      }])
      editorRef.createShape({
        id: shapeId,
        type: 'image',
        x: topLeft.x + i * (IMG_W + GAP),
        y: topLeft.y + 40,
        props: { assetId, w: IMG_W, h: IMG_H },
      })
    })
  },

  placeYouTubeVideos: (videoIds: string[]) => {
    const { editorRef, placedMediaIds } = get()
    if (!editorRef) return

    const newIds = videoIds.filter(id => !placedMediaIds.includes(`yt-${id}`))
    if (newIds.length === 0) return

    set(s => ({ placedMediaIds: [...s.placedMediaIds, ...newIds.map(id => `yt-${id}`)] }))

    const viewportBounds = editorRef.getViewportScreenBounds()
    const topLeft = editorRef.screenToPage({ x: viewportBounds.x, y: viewportBounds.y })

    const W = 480
    const H = 306
    const GAP = 20

    newIds.forEach((videoId, i) => {
      // Deterministic ID so focusOrPlaceMedia can locate the shape later
      const shapeId = createShapeId('yt-' + videoId)
      editorRef.createShape({
        id: shapeId,
        type: 'youtube',
        x: topLeft.x + i * (W + GAP),
        y: topLeft.y + 40,
        props: { videoId, w: W, h: H },
      })
    })
  },

  clearPlacedMedia: () => set({ placedMediaIds: [] }),

  focusOrPlaceMedia: (key: string) => {
    const { editorRef } = get()
    if (!editorRef) return

    if (key.startsWith('yt-')) {
      const videoId = key.slice(3)
      const shapeId = createShapeId('yt-' + videoId)
      const shape = editorRef.getShape(shapeId)
      if (shape) {
        editorRef.setSelectedShapes([shapeId])
        editorRef.zoomToSelection()
      } else {
        // Shape was deleted — allow re-placement then place
        set(s => ({ placedMediaIds: s.placedMediaIds.filter(id => id !== `yt-${videoId}`) }))
        get().placeYouTubeVideos([videoId])
      }
    } else if (key.startsWith('img-')) {
      const url = key.slice(4)
      const urlKey = encodeURIComponent(url).slice(0, 50)
      const shapeId = createShapeId('img-' + urlKey)
      const shape = editorRef.getShape(shapeId)
      if (shape) {
        editorRef.setSelectedShapes([shapeId])
        editorRef.zoomToSelection()
      } else {
        // Shape was deleted — allow re-placement then place
        set(s => ({ placedMediaIds: s.placedMediaIds.filter(id => id !== `img-${url}`) }))
        get().placeScrapedMedia([url], [])
      }
    }
  },

  playScene: (scene: WhiteboardScene, onSpeak: (text: string) => Promise<void>) => {
    const { editorRef } = get()
    if (!editorRef) {
      console.warn('Cannot play scene: no editor reference')
      return
    }

    // Stop any existing playback
    if (currentPlayer) {
      currentPlayer.stop()
      currentPlayer = null
    }

    // Create ActionPlayer with callbacks
    const player = new ActionPlayer(scene, {
      onSubtitle: (text: string) => {
        set({ currentSubtitle: text })
      },
      onPlaybackState: (state: PlaybackState) => {
        set({ playbackState: state })
      },
      onWhiteboardAction: (action: WhiteboardAction) => {
        const { editorRef: ed } = get()
        if (!ed) return

        // Execute the whiteboard action
        if (action.type === 'create_text') {
          const shapeId = createShapeId(action.id)
          ed.createShape({
            id: shapeId,
            type: 'text',
            x: action.position.x * 100,  // Scale grid position
            y: action.position.y * 100,
            props: {
              text: action.text,
              size: action.style === 'heading' ? 'xl' : action.style === 'body' ? 'm' : 'l',
            },
          })
        } else if (action.type === 'create_box') {
          const shapeId = createShapeId(action.id)
          ed.createShape({
            id: shapeId,
            type: 'geo',
            x: action.position.x * 100,
            y: action.position.y * 100,
            props: {
              geo: 'rectangle',
              w: 200,
              h: 100,
            },
          })
        } else if (action.type === 'highlight') {
          // Highlight effect - could add a note or visual marker
          console.log('Highlight action:', action.id)
        }
      },
      onSpeak: onSpeak,
      onComplete: () => {
        set({
          playbackState: { isPlaying: false, currentIndex: 0, totalSubtitles: 0 },
          currentSubtitle: ''
        })
        currentPlayer = null
      },
    })

    currentPlayer = player
    player.play()
  },

  stopPlayback: () => {
    if (currentPlayer) {
      currentPlayer.stop()
      currentPlayer = null
    }
    set({
      playbackState: { isPlaying: false, currentIndex: 0, totalSubtitles: 0 },
      currentSubtitle: ''
    })
  },
}))