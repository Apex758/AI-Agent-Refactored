import { create } from 'zustand'
import type { Editor } from 'tldraw'
import type { ScenePlan } from '@/components/whiteboard/types'

interface WhiteboardStore {
  /** TLDraw snapshots keyed by chatId */
  snapshots: Record<string, any>
  /** Current editor instance */
  editorRef: Editor | null

  setEditor: (editor: Editor | null) => void
  saveSnapshot: (chatId: string) => void
  loadSnapshot: (chatId: string) => void
  exportAsImage: () => Promise<Blob | null>
  presentOnBoard: (scenePlan: ScenePlan) => void
  placeScrapedMedia: (images: string[], videoIds: string[]) => void
}

export const useWhiteboardStore = create<WhiteboardStore>((set, get) => ({
  snapshots: {},
  editorRef: null,

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
    const { editorRef } = get()
    if (!editorRef) return
    if (images.length === 0 && videoIds.length === 0) return

    const viewportBounds = editorRef.getViewportScreenBounds()
    const topLeft = editorRef.screenToPage({ x: viewportBounds.x, y: viewportBounds.y })

    // Place images in a row starting from the top-left of the viewport
    const IMG_W = 240
    const IMG_H = 180
    const GAP = 16

    images.slice(0, 6).forEach((src, i) => {
      const assetId = `asset:scraped-img-${Date.now()}-${i}` as any
      editorRef.createAssets([{
        id: assetId,
        type: 'image',
        typeName: 'asset',
        props: {
          name: `scraped-${i}`,
          src,
          w: IMG_W,
          h: IMG_H,
          mimeType: 'image/jpeg',
          isAnimated: false,
        },
        meta: {},
      }])
      editorRef.createShape({
        type: 'image',
        x: topLeft.x + i * (IMG_W + GAP),
        y: topLeft.y + 40,
        props: { assetId, w: IMG_W, h: IMG_H },
      })
    })

    // Place YouTube video thumbnails as image shapes below the images
    const yOffset = images.length > 0 ? IMG_H + GAP * 3 : 40
    const VIDEO_W = 240
    const VIDEO_H = 135 // 16:9 aspect ratio
    videoIds.slice(0, 4).forEach((vtId, i) => {
      const thumbUrl = `https://img.youtube.com/vi/${vtId}/mqdefault.jpg`
      const assetId = `asset:scraped-video-${Date.now()}-${i}` as any
      editorRef.createAssets([{
        id: assetId,
        type: 'image',
        typeName: 'asset',
        props: {
          name: `video-${vtId}`,
          src: thumbUrl,
          w: VIDEO_W,
          h: VIDEO_H,
          mimeType: 'image/jpeg',
          isAnimated: false,
        },
        meta: {},
      }])
      editorRef.createShape({
        type: 'image',
        x: topLeft.x + i * (VIDEO_W + GAP),
        y: topLeft.y + yOffset,
        props: { assetId, w: VIDEO_W, h: VIDEO_H },
      })
    })
  },
}))