'use client'
import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useWhiteboardStore, PAGES } from '@/store/whiteboardStore'
import { useUIStore } from '@/store/uiStore'
import { cleanForTTS } from '@/utils/textCleaner'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

/** Extract complete sentences from a streaming buffer. */
function extractSentences(buf: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = []
  const re = /[^.!?]*[.!?]+\s*/g
  let match: RegExpExecArray | null
  let lastEnd = 0
  while ((match = re.exec(buf)) !== null) {
    const s = match[0].trim()
    if (s.length > 2) sentences.push(s)
    lastEnd = re.lastIndex
  }
  return { sentences, remainder: buf.slice(lastEnd) }
}

/** Generate a short unique ID for TTS request correlation */
function genRequestId(): string {
  return Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
}

export function useWebSocket(clientId: string, onSentence?: (text: string) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const clientIdRef = useRef(clientId)
  const sendRef = useRef<((msg: string) => void) | null>(null)
  const messageQueueRef = useRef<string[]>([])
  const { appendStreaming, finalizeStreaming, setError, setCitations, addScrapedMedia } = useChatStore()

  const onSentenceRef   = useRef(onSentence)
  const streamBufferRef = useRef('')
  const streamSpokenRef = useRef(false)

  useEffect(() => { onSentenceRef.current = onSentence }, [onSentence])
  useEffect(() => { clientIdRef.current = clientId }, [clientId])

  const flushSentences = (isFinal: boolean) => {
    if (!onSentenceRef.current) return
    const { sentences, remainder } = extractSentences(streamBufferRef.current)
    sentences.forEach(s => {
      onSentenceRef.current!(s)
      streamSpokenRef.current = true
    })
    if (isFinal && remainder.trim().length > 2) {
      onSentenceRef.current(remainder.trim())
      streamSpokenRef.current = true
    }
    streamBufferRef.current = isFinal ? '' : remainder
  }

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
            streamBufferRef.current += msg.content
            flushSentences(false)
            break
          case 'complete':
            flushSentences(true)
            finalizeStreaming()
            break
          case 'citations':
            setCitations(msg.citations || [])
            break
          case 'error':
            setError(msg.content)
            break
          case 'media':
            console.log('[DEBUG WS] Received media event:', { images: msg.images, videos: msg.videos })
            addScrapedMedia(msg.images ?? [], msg.videos ?? [])
            break

          case 'visual_plan': {
            // Backend sent a structured diagram plan → build on Teaching page
            if (msg.plan && msg.plan.visuals?.length) {
              console.log(`[ws] Visual plan received: ${msg.plan.topic} (${msg.plan.visuals.length} diagrams)`)
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
      streamBufferRef.current = ''
      streamSpokenRef.current = false
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

  // TTS request + wait for playback
  const speakAndWait = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      const ws = wsRef.current
      const clean = cleanForTTS(text)
      if (!clean) { resolve(); return }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        resolve()
        return
      }

      const requestId = genRequestId()
      let resolved = false
      const done = () => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        ws.removeEventListener('message', onMessage)
        resolve()
      }

      const timer = setTimeout(() => done(), 15000)

      const onMessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'tts_audio' && msg.request_id === requestId) {
            clearTimeout(timer)
            ws.removeEventListener('message', onMessage)
            resolved = true
            const binary = atob(msg.audio)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            const blob = new Blob([bytes], { type: 'audio/wav' })
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            const onDone = () => { URL.revokeObjectURL(url); resolve() }
            audio.onended = onDone
            audio.onerror = onDone
            audio.play().catch(() => onDone())
          } else if (msg.type === 'tts_error' && msg.request_id === requestId) {
            done()
          }
        } catch (e) { /* not our message */ }
      }

      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ type: 'tts', text: clean, request_id: requestId }))
    })
  }, [])

  // Whiteboard scene → switch to Teaching page + whiteboard mode, then play
  const handleWhiteboardScene = useCallback((scene: any) => {
    if (!scene) return
    useUIStore.getState().setMode('whiteboard')
    setTimeout(() => {
      const wb = useWhiteboardStore.getState()
      wb.switchToPage(PAGES.TEACHING)
      wb.playScene(scene, speakAndWait)
    }, 500)
  }, [speakAndWait])
  
  const send = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ message }))
    } else {
      messageQueueRef.current.push(message)
    }
  }, [])

  return { send, streamSpokenRef }
}