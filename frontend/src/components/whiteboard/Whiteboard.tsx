'use client'

import { useCallback, useEffect, useRef } from 'react'
import { Tldraw, Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { useWhiteboardStore } from '@/store/whiteboardStore'
import { YouTubeShapeUtil } from './YouTubeShapeUtil'
import { useFrameReflow } from '@/hooks/useFrameReflow'

const SHAPE_UTILS = [YouTubeShapeUtil]

interface WhiteboardProps {
  chatId: string
}

export default function Whiteboard({ chatId }: WhiteboardProps) {
  const { setEditor, saveSnapshot, loadSnapshot, clearPlacedMedia } = useWhiteboardStore()
  
  const editor = useWhiteboardStore((s) => s.editor)
  const editorRef = useRef<Editor | null>(null)
  const prevChatIdRef = useRef<string>(chatId)

  useFrameReflow(editor)

  const handleMount = useCallback(
    (mountedEditor: Editor) => {
      editorRef.current = mountedEditor
      setEditor(mountedEditor)

      // loadSnapshot now also calls ensurePages() internally,
      // so the four named pages are always created/verified here.
      loadSnapshot(chatId)
    },
    [chatId, setEditor, loadSnapshot],
  )

  // When chatId changes, save old snapshot and load new one.
  // loadSnapshot handles clearing old shapes + ensuring pages.
  useEffect(() => {
    if (prevChatIdRef.current !== chatId && editorRef.current) {
      saveSnapshot(prevChatIdRef.current)
      clearPlacedMedia()
      loadSnapshot(chatId)
      prevChatIdRef.current = chatId
    }
  }, [chatId, saveSnapshot, loadSnapshot, clearPlacedMedia])

  // Auto-save on component unmount
  useEffect(() => {
    return () => {
      if (editorRef.current && prevChatIdRef.current) {
        saveSnapshot(prevChatIdRef.current)
      }
    }
  }, [saveSnapshot])

  // Save whiteboard on page unload (refresh / close tab)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (editorRef.current && prevChatIdRef.current) {
        saveSnapshot(prevChatIdRef.current)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [saveSnapshot])

  // Periodic auto-save every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (editorRef.current && prevChatIdRef.current) {
        saveSnapshot(prevChatIdRef.current)
      }
    }, 5_000)
    return () => clearInterval(interval)
  }, [saveSnapshot])

  return (
    <div className="whiteboard-container" style={{ position: 'absolute', inset: 0 }}>
      <Tldraw onMount={handleMount} shapeUtils={SHAPE_UTILS} />
    </div>
  )
}