'use client'

import { useCallback, useEffect, useRef } from 'react'
import { Tldraw, Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { useWhiteboardStore } from '@/store/whiteboardStore'
import { YouTubeShapeUtil } from './YouTubeShapeUtil'

const SHAPE_UTILS = [YouTubeShapeUtil]

interface WhiteboardProps {
  chatId: string
}

export default function Whiteboard({ chatId }: WhiteboardProps) {
  const { setEditor, saveSnapshot, loadSnapshot, clearPlacedMedia } = useWhiteboardStore()
  const editorRef = useRef<Editor | null>(null)
  const prevChatIdRef = useRef<string>(chatId)

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      setEditor(editor)

      // Load existing snapshot for this chat
      loadSnapshot(chatId)
    },
    [chatId, setEditor, loadSnapshot],
  )

  // When chatId changes, save current snapshot and load new one
  useEffect(() => {
    if (prevChatIdRef.current !== chatId && editorRef.current) {
      // Save old
      saveSnapshot(prevChatIdRef.current)
      // Clear placed media tracking for new chat
      clearPlacedMedia()
      // Clear and load new
      const editor = editorRef.current
      // Delete all shapes on current page before loading new snapshot
      const allShapeIds = [...editor.getCurrentPageShapeIds()]
      if (allShapeIds.length > 0) {
        editor.deleteShapes(allShapeIds)
      }
      loadSnapshot(chatId)
      prevChatIdRef.current = chatId
    }
  }, [chatId, saveSnapshot, loadSnapshot, clearPlacedMedia])

  // Auto-save on unmount
  useEffect(() => {
    return () => {
      if (editorRef.current && prevChatIdRef.current) {
        saveSnapshot(prevChatIdRef.current)
      }
    }
  }, [saveSnapshot])

  return (
    <div className="whiteboard-container" style={{ position: 'absolute', inset: 0 }}>
      <Tldraw onMount={handleMount} shapeUtils={SHAPE_UTILS} />
    </div>
  )
}
