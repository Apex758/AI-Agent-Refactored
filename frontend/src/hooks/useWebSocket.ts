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

/**
 * Browser TTS speak-and-wait: returns a Promise that resolves when the
 * utterance finishes. Uses the same voice as useVoice (first English voice).
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

export function useWebSocket(clientId: string, onSentence?: (text: string) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const clientIdRef = useRef(clientId)
  const messageQueueRef = useRef<string[]>([])
  const { appendStreaming, finalizeStreaming, setError, setCitations, addScrapedMedia } = useChatStore()

  const onSentenceRef      = useRef(onSentence)
  const streamBufferRef    = useRef('')
  const streamSpokenRef    = useRef(false)

  /**
   * When a visual_plan arrives (before tokens), we know a whiteboard scene
   * will follow. Suppress streaming sentence TTS so only the scene's
   * subtitles speak — prevents hearing the same content twice.
   */
  const sceneExpectedRef   = useRef(false)

  useEffect(() => { onSentenceRef.current = onSentence }, [onSentence])
  useEffect(() => { clientIdRef.current = clientId }, [clientId])

  const flushSentences = (isFinal: boolean) => {
    if (!onSentenceRef.current) return
    // If a scene is expected, skip streaming TTS — scene subtitles will handle it
    if (sceneExpectedRef.current) return

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
            // Reset scene flag after response completes
            sceneExpectedRef.current = false
            break
          case 'citations':
            setCitations(msg.citations || [])
            break
          case 'error':
            setError(msg.content)
            sceneExpectedRef.current = false
            break
          case 'media':
            addScrapedMedia(msg.images ?? [], msg.videos ?? [])
            break

          case 'visual_plan': {
            if (msg.plan && msg.plan.visuals?.length) {
              console.log(`[ws] Visual plan received — suppressing streaming TTS`)
              // Signal: a scene will follow, suppress streaming sentence TTS
              sceneExpectedRef.current = true

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
      sceneExpectedRef.current = false
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

  // Whiteboard scene → kill any leftover streaming speech, switch to board, play scene
  const handleWhiteboardScene = useCallback((scene: any) => {
    if (!scene) return

    // Cancel any in-progress browser TTS (leftover streaming sentences)
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }

    useUIStore.getState().setMode('whiteboard')
    setTimeout(() => {
      const wb = useWhiteboardStore.getState()
      wb.switchToPage(PAGES.TEACHING)
      // Scene subtitles will speak via browserSpeakAndWait (same male voice)
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

  return { send, streamSpokenRef }
}