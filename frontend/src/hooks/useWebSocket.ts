'use client'
import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useWhiteboardStore } from '@/store/whiteboardStore'
import { useUIStore } from '@/store/uiStore'
import { cleanForTTS } from '@/utils/textCleaner'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

export function useWebSocket(clientId: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const clientIdRef = useRef(clientId)
  const sendRef = useRef<((msg: string) => void) | null>(null)
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
            console.log('[DEBUG WS] Received media event:', { images: msg.images, videos: msg.videos })
            addScrapedMedia(msg.images ?? [], msg.videos ?? [])
            break
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


  // Browser SpeechSynthesis fallback — used when server TTS fails or is unavailable
  const speakBrowser = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve()
        return
      }
      window.speechSynthesis.cancel()
      const utt = new SpeechSynthesisUtterance(text)
      utt.rate = 1.05
      utt.onend = () => resolve()
      utt.onerror = () => resolve()
      window.speechSynthesis.speak(utt)
    })
  }, [])

  // Helper to send TTS request and wait for audio playback to complete
  const speakAndWait = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      const ws = wsRef.current
      const clean = cleanForTTS(text)
      if (!clean) { resolve(); return }

      // No open WebSocket — go straight to browser TTS
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        speakBrowser(clean).then(resolve)
        return
      }

      let resolved = false
      const done = (fallback = false) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        ws.removeEventListener('message', onMessage)
        if (fallback) {
          speakBrowser(clean).then(resolve)
        } else {
          resolve()
        }
      }

      // 15-second fallback so ActionPlayer never hangs on a dead TTS promise
      const timer = setTimeout(() => done(true), 15000)

      const onMessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'tts_audio') {
            // Stop listening before playing so we don't catch the next subtitle's audio
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
          } else if (msg.type === 'tts_error') {
            // Server TTS failed — fall back to browser speech so user still hears audio
            done(true)
          }
        } catch (e) {
          // Not our message, ignore
        }
      }

      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ type: 'tts', text: clean }))
    })
  }, [speakBrowser])

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

  return { send }
}