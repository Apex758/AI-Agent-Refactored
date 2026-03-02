'use client'
import { useState } from 'react'
import { BaseBoxShapeUtil, TLBaseShape, T } from 'tldraw'
import Icon from '../Icon'

// ── Shape type ────────────────────────────────────────────────────
export type YouTubeShape = TLBaseShape<
  'youtube',
  { videoId: string; w: number; h: number }
>

const TITLE_H = 36 // px — height of the red title-bar chrome

// Module-level map: persists "activated" (clicked-to-play) state across
// TLDraw re-mounts of the shape component (which would reset useState).
const activatedShapes = new Map<string, boolean>()

// ── Inner React component (needs hooks → separate from the util) ──
function YouTubeShapeComponent({
  shape,
  editor,
}: {
  shape: YouTubeShape
  editor: any
}) {
  // Initialise from the persistent map so re-mounts don't reset playback
  const [activated, setActivated] = useState(() => activatedShapes.get(shape.id) ?? false)
  const [thumbError, setThumbError] = useState(false)

  const { videoId, w, h } = shape.props
  const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
  const embedUrl = `https://www.youtube.com/embed/${videoId}`

  const handleClose = (e: React.PointerEvent) => {
    e.stopPropagation()
    activatedShapes.delete(shape.id) // clean up when frame is removed
    editor.deleteShapes([shape.id])
  }

  const handlePlay = (e: React.PointerEvent) => {
    e.stopPropagation()
    activatedShapes.set(shape.id, true) // persist across re-mounts
    setActivated(true)
  }

  return (
    <div
      style={{
        width: w,
        height: h,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 8,
        overflow: 'hidden',
        border: '2px solid #ff0000',
        background: '#0f0f0f',
        fontFamily: 'sans-serif',
        boxSizing: 'border-box',
        pointerEvents: 'all',
      }}
    >
      {/* ── Title bar ── Let TLDraw receive these events so the shape stays
          draggable/selectable/resizable. The close button stops propagation
          in its own handler, which is enough for that one interaction. */}
      <div
        style={{
          height: TITLE_H,
          background: '#ff0000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          flexShrink: 0,
          pointerEvents: 'all',
        }}
      >
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 13, letterSpacing: 0.3 }}>
          <Icon name="play" size={14} /> YouTube
        </span>
        <button
          onPointerDown={handleClose}
          style={{
            background: 'rgba(0,0,0,0.35)',
            border: 'none',
            color: '#fff',
            width: 22,
            height: 22,
            borderRadius: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 900,
            flexShrink: 0,
            lineHeight: 1,
            pointerEvents: 'all',
          }}
        >
          <Icon name="close" size={12} />
        </button>
      </div>

      {/* ── Video / thumbnail area ──
          stopPropagation prevents TLDraw from dragging the shape when the
          user interacts with the video body — dragging is only possible via
          the title bar above. */}
      <div
        style={{ flex: 1, position: 'relative', background: '#000', overflow: 'hidden' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {activated ? (
          <iframe
            src={embedUrl}
            width="100%"
            height="100%"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ border: 'none', display: 'block', pointerEvents: 'all' }}
          />
        ) : (
          /* Click-to-play thumbnail */
          <div
            onPointerDown={handlePlay}
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {!thumbError ? (
              <img
                src={thumbUrl}
                alt="YouTube thumbnail"
                draggable={false}
                onError={() => setThumbError(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              /* Fallback when thumbnail 404s */
              <div style={{ width: '100%', height: '100%', background: '#111' }} />
            )}
            {/* YouTube play button overlay */}
            <div
              style={{
                position: 'absolute',
                width: 60,
                height: 42,
                background: '#ff0000',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
              }}
            >
              <Icon name="play" size={24} color="#fff" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── TLDraw v2 shape utility ───────────────────────────────────────
export class YouTubeShapeUtil extends BaseBoxShapeUtil<YouTubeShape> {
  static override type = 'youtube' as const
  static override props = {
    videoId: T.string,
    w: T.number,
    h: T.number,
  }

  getDefaultProps(): YouTubeShape['props'] {
    return { videoId: '', w: 480, h: 306 } // 306 = 36 titlebar + 270 video (16:9)
  }

  component(shape: YouTubeShape) {
    return <YouTubeShapeComponent shape={shape} editor={this.editor} />
  }

  indicator(shape: YouTubeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />
  }
}
