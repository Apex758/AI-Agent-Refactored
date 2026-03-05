'use client'
import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useWhiteboardStore, PAGES } from '@/store/whiteboardStore'
import { useUIStore } from '@/store/uiStore'
import { cleanForTTS } from '@/utils/textCleaner'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

/**
 * Browser TTS speak-and-wait: returns a Promise that resolves when the
 * utterance finishes. Used by subtitle playback only.
 */
function browserSpeakAndWait(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve()
      return
    }
    const clean = cleanForTTS(text)
    if (!clean) { resolve(); return }

    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.rate  = 1.0
    utterance.pitch = 1.0
    utterance.lang  = 'en-US'

    // Pick the same voice as useVoice
    const voices = window.speechSynthesis.getVoices()
    const preferred =
      voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) ||
      voices.find(v => v.lang.startsWith('en') && !v.localService) ||
      voices.find(v => v.lang.startsWith('en'))
    if (preferred) utterance.voice = preferred

    utterance.onend   = () => resolve()
    utterance.onerror = () => resolve()

    window.speechSynthesis.speak(utterance)
  })
}

export function useWebSocket(clientId: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const clientIdRef = useRef(clientId)
  const messageQueueRef = useRef<string[]>([])
  const { appendStreaming, finalizeStreaming, setError, setCitations, addScrapedMedia } = useChatStore()

  useEffect(() => { clientIdRef.current = clientId }, [clientId])

  const connect = useCallback((id: string) => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    if (!id) return

    const ws = new WebSocket(`${WS_BASE}/api/ws/${id}`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        switch (msg.type) {
          case 'token':
            appendStreaming(msg.content)
            break
          case 'complete':
            finalizeStreaming()
            break
          case 'citations':
            setCitations(msg.citations || [])
            break
          case 'error':
            setError(msg.content)
            break
          case 'media':
            addScrapedMedia(msg.images ?? [], msg.videos ?? [])
            break

          case 'teaching_media': {
            const wb = useWhiteboardStore.getState()
            useUIStore.getState().setMode('whiteboard')
            wb.switchToPage(PAGES.TEACHING)
            wb.placeTeachingImage(msg.images ?? [])
            break
          }

          case 'visual_plan': {
            if (msg.plan && msg.plan.visuals?.length) {
              console.log(`[ws] Visual plan received`)
              const wb = useWhiteboardStore.getState()
              wb.switchToPage(PAGES.TEACHING)
              wb.buildVisualPlan(msg.plan)
            }
            break
          }

          case 'whiteboard_scene':
            handleWhiteboardScene(msg.scene)
            break
        }
      } catch (err) {
        console.error('WS parse error:', err)
      }
    }

    ws.onopen = () => {
      setError(null)
      while (messageQueueRef.current.length > 0) {
        const queued = messageQueueRef.current.shift()!
        ws.send(JSON.stringify({ message: queued }))
      }
    }
    ws.onclose = () => {
      setTimeout(() => {
        if (clientIdRef.current === id) connect(id)
      }, 3000)
    }
    ws.onerror = () => {}

    return ws
  }, [appendStreaming, finalizeStreaming, setError, setCitations])

  useEffect(() => {
    if (clientId) connect(clientId)
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [clientId])

  // Whiteboard scene → kill any leftover speech, switch to board, play scene subtitles
  const handleWhiteboardScene = useCallback((scene: any) => {
    if (!scene) return

    // Cancel any in-progress browser TTS
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }

    useUIStore.getState().setMode('whiteboard')
    setTimeout(() => {
      const wb = useWhiteboardStore.getState()
      wb.switchToPage(PAGES.TEACHING)
      // Scene subtitles speak via browserSpeakAndWait
      wb.playScene(scene, browserSpeakAndWait)
    }, 500)
  }, [])
  
  const send = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ message }))
    } else {
      messageQueueRef.current.push(message)
    }
  }, [])

  return { send }
}