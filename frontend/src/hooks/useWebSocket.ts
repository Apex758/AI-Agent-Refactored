'use client'
import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '@/store/chatStore'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

export function useWebSocket(clientId: string = 'default') {
  const wsRef = useRef<WebSocket | null>(null)
  const { appendStreaming, finalizeStreaming, setError, addMessage } = useChatStore()

  const connect = useCallback(() => {
    const ws = new WebSocket(`${WS_BASE}/api/ws/${clientId}`)
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
          case 'system':
            addMessage({ id: Date.now().toString(), role: 'system', content: msg.content, timestamp: Date.now() })
            break
          case 'error':
            setError(msg.content)
            break
        }
      } catch (err) {
        console.error('WS parse error:', err)
      }
    }

    ws.onclose = () => setTimeout(connect, 3000) // Auto-reconnect
    ws.onerror = () => setError('Connection error — retrying...')

    return ws
  }, [clientId, appendStreaming, finalizeStreaming, setError, addMessage])

  useEffect(() => {
    const ws = connect()
    return () => { ws.close() }
  }, [connect])

  const send = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ message }))
    }
  }, [])

  return { send }
}
