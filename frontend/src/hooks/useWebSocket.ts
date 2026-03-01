'use client'
import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '@/store/chatStore'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

export function useWebSocket(clientId: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const clientIdRef = useRef(clientId)
  const { appendStreaming, finalizeStreaming, setError, addMessage } = useChatStore()

  // Track clientId changes so reconnect uses latest value
  useEffect(() => {
    clientIdRef.current = clientId
  }, [clientId])

  const connect = useCallback((id: string) => {
    // Close any existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null // prevent auto-reconnect on intentional close
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
          case 'error':
            setError(msg.content)
            break
          // Ignore 'system' type — no welcome message
        }
      } catch (err) {
        console.error('WS parse error:', err)
      }
    }

    ws.onopen = () => setError(null)

    ws.onclose = () => {
      // Auto-reconnect after 3s only if this is still the active chat
      setTimeout(() => {
        if (clientIdRef.current === id && document.visibilityState !== 'hidden') {
          connect(id)
        }
      }, 3000)
    }

    ws.onerror = () => {
      // Silent — let onclose handle reconnect
    }

    return ws
  }, [appendStreaming, finalizeStreaming, setError, addMessage])

  useEffect(() => {
    if (clientId) {
      connect(clientId)
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [clientId]) // reconnect when chat changes

  const send = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ message }))
    }
  }, [])

  return { send }
}
