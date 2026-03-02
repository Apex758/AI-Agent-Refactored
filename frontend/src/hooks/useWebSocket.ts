'use client'
import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useWhiteboardStore } from '@/store/whiteboardStore'
import { useUIStore } from '@/store/uiStore'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

export function useWebSocket(clientId: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const clientIdRef = useRef(clientId)
  const sendRef = useRef<((msg: string) => void) | null>(null)
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

    ws.onopen = () => setError(null)
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


  // Helper to send TTS request and wait for audio playback to complete
  const speakAndWait = useCallback((text: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('WebSocket not connected for TTS')
        resolve()
        return
      }

      // Clean text for TTS
      const clean = text.replace(/[#*_~`]/g, '').trim()
      if (!clean) {
        resolve()
        return
      }

      // Set up one-time listener for TTS audio response
      const onMessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'tts_audio') {
            ws.removeEventListener('message', onMessage)
            // Decode base64 audio and play
            const binary = atob(msg.audio)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i)
            }
            const blob = new Blob([bytes], { type: 'audio/mp3' })
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            audio.onended = () => {
              URL.revokeObjectURL(url)
              resolve()
            }
            audio.onerror = () => {
              URL.revokeObjectURL(url)
              resolve()  // Don't reject, just continue
            }
            audio.play().catch(() => resolve())
          }
        } catch (e) {
          // Not our message, ignore
        }
      }

      ws.addEventListener('message', onMessage)
      
      // Send TTS request
      ws.send(JSON.stringify({
        type: 'tts',
        text: clean,
      }))
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
    }
  }, [])

  return { send }
}