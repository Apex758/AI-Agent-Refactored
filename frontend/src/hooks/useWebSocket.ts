'use client'
import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useWhiteboardStore } from '@/store/whiteboardStore'
import { useUIStore } from '@/store/uiStore'
import { cleanForTTS } from '@/utils/textCleaner'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

/** Extract complete sentences from a streaming buffer.
 * Returns the sentences found plus any trailing text without terminal punctuation. */
function extractSentences(buf: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = []
  // Match any text ending with .  !  or  ?  (with optional trailing whitespace)
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

  // Sentence-streaming TTS refs
  const onSentenceRef   = useRef(onSentence)
  const streamBufferRef = useRef('')       // accumulates LLM tokens
  const streamSpokenRef = useRef(false)    // true once ≥1 sentence was TTS'd this stream

  useEffect(() => { onSentenceRef.current = onSentence }, [onSentence])
  useEffect(() => { clientIdRef.current = clientId }, [clientId])

  /** Flush complete sentences from the buffer; drain remainder on final call. */
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
            // Backend sent a structured diagram plan — build it on the whiteboard
            if (msg.plan && msg.plan.visuals?.length) {
              console.log(`[ws] Visual plan received: ${msg.plan.topic} (${msg.plan.visuals.length} diagrams)`)
              useWhiteboardStore.getState().buildVisualPlan(msg.plan)
            }
            break
          }
          case 'whiteboard_scene':
            // FIX: Do NOT pre-synthesize here. ActionPlayer will call
            // speakAndWait sequentially for each subtitle with a unique
            // request_id so the correct audio plays for each subtitle.
            handleWhiteboardScene(msg.scene)
            break
        }
      } catch (err) {
        console.error('WS parse error:', err)
      }
    }

    ws.onopen = () => {
      // Reset sentence-streaming state for fresh connection
      streamBufferRef.current = ''
      streamSpokenRef.current = false
      setError(null)
      // Drain any messages queued while the socket was connecting
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


  // Helper to send TTS request and wait for audio playback to complete (Piper only).
  // FIX: Uses a unique request_id so we only resolve when the MATCHING audio arrives,
  // not some other subtitle's audio that happened to arrive first.
  const speakAndWait = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      const ws = wsRef.current
      const clean = cleanForTTS(text)
      if (!clean) { resolve(); return }

      // No open WebSocket — skip silently (Piper only, no browser fallback)
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

      // 15-second safety timeout so ActionPlayer never hangs
      const timer = setTimeout(() => done(), 15000)

      const onMessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)

          // FIX: Only handle tts_audio with OUR request_id
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
            // Piper failed for this request — resolve silently
            done()
          }
        } catch (e) {
          // Not our message, ignore
        }
      }

      ws.addEventListener('message', onMessage)
      // FIX: Include request_id so backend echoes it back
      ws.send(JSON.stringify({ type: 'tts', text: clean, request_id: requestId }))
    })
  }, [])

  const handleWhiteboardScene = useCallback((scene: any) => {
    if (!scene) return
    // Switch to whiteboard mode
    useUIStore.getState().setMode('whiteboard')
    // Small delay to let TLDraw mount, then play the scene
    setTimeout(() => {
      useWhiteboardStore.getState().playScene(scene, speakAndWait)
    }, 500)
  }, [speakAndWait])
  
  const send = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ message }))
    } else {
      // Queue the message — will be flushed in ws.onopen when the socket connects
      messageQueueRef.current.push(message)
    }
  }, [])

  return { send, streamSpokenRef }
}