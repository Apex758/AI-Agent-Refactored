/**
 * useFrameReflow — Watches for frame resizes and reflows child text.
 *
 * TLDraw problem: when you resize a frame, children stay at their
 * original width. Text doesn't rewrap. This hook fixes that.
 *
 * How it works:
 *   1. Listens to TLDraw's store changes (shape updates)
 *   2. When a frame's width or height changes, find all child text/geo shapes
 *   3. Rescale their width proportionally to the new frame size
 *   4. Text naturally rewraps because TLDraw recalculates line breaks
 *
 * Usage in your whiteboard component:
 *   const editor = useEditor()
 *   useFrameReflow(editor)
 */

import { useEffect, useRef } from 'react'
import { Editor, TLShape, TLShapeId } from 'tldraw'

const PADDING = 50 // matches FRAME.PAD in DiagramBuilder

interface FrameSnapshot {
  w: number
  h: number
}

export function useFrameReflow(editor: Editor | null) {
  const prevFrames = useRef<Map<TLShapeId, FrameSnapshot>>(new Map())

  useEffect(() => {
    if (!editor) return

    // Take initial snapshot of all frames
    const initSnapshot = () => {
      const frames = editor.getCurrentPageShapes().filter(s => s.type === 'frame')
      for (const frame of frames) {
        const props = frame.props as any
        prevFrames.current.set(frame.id, {
          w: props.w || 800,
          h: props.h || 1100,
        })
      }
    }
    initSnapshot()

    // Listen for shape changes
    const unsub = editor.store.listen(
      ({ changes }) => {
        const updated = changes.updated as Record<string, [TLShape, TLShape]> | undefined
        if (!updated) return

        for (const [before, after] of Object.values(updated)) {
          if (after.type !== 'frame') continue

          const prevW = (before.props as any).w
          const prevH = (before.props as any).h
          const newW = (after.props as any).w
          const newH = (after.props as any).h

          // Only act on actual width/height changes (not position changes)
          if (prevW === newW && prevH === newH) continue

          const scaleX = newW / prevW
          const contentW = newW - 2 * PADDING

          // Find all children of this frame
          const children = editor.getSortedChildIdsForParent(after.id)

          for (const childId of children) {
            const child = editor.getShape(childId)
            if (!child) continue

            const childProps = child.props as any

            if (child.type === 'text' && !childProps.autoSize) {
              // Reflow text: set width to new content area
              editor.updateShape({
                id: child.id,
                type: 'text',
                x: child.x * scaleX, // reposition proportionally
                props: {
                  ...childProps,
                  w: contentW,
                },
              })
            } else if (child.type === 'geo') {
              // Scale geo shapes proportionally
              const oldW = childProps.w || 100
              editor.updateShape({
                id: child.id,
                type: 'geo',
                x: child.x * scaleX,
                props: {
                  ...childProps,
                  w: oldW * scaleX,
                },
              })
            }
            // Arrows auto-adjust via bindings, no manual update needed
          }

          // Update snapshot
          prevFrames.current.set(after.id, { w: newW, h: newH })
        }
      },
      { source: 'user', scope: 'document' },
    )

    return unsub
  }, [editor])
}
