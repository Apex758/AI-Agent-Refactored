'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { UseWebSocketReturn, WSMessage, ChatMessagePayload, ToolResultPayload, ErrorPayload } from '@/types'
import { useChatStore } from '@/store/chatStore'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws'

export function useWebSocket(): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null)
  
  const { addMessage, updateStreamingContent, setProcessing, addToolResult, setError } = useChatStore()

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WSMessage = JSON.parse(event.data)
      setLastMessage(message)

      switch (message.type) {
        case 'message': {
          const payload = message.payload as ChatMessagePayload
          updateStreamingContent(payload.message.content)
          break
        }
        case 'tool_result': {
          const payload = message.payload as ToolResultPayload
          addToolResult({
            toolCallId: payload.toolCallId,
            result: payload.result,
            error: payload.error,
          })
          break
        }
        case 'error': {
          const payload = message.payload as ErrorPayload
          setError(payload.message)
          break
        }
        case 'connected': {
          setIsConnected(true)
          break
        }
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err)
    }
  }, [addMessage, updateStreamingContent, addToolResult, setError])

  const handleOpen = useCallback(() => {
    setIsConnected(true)
  }, [])

  const handleClose = useCallback(() => {
    setIsConnected(false)
    setProcessing(false)
  }, [setProcessing])

  const handleError = useCallback((event: Event) => {
    console.error('WebSocket error:', event)
    setError('Connection error')
  }, [setError])

  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.addEventListener('open', handleOpen)
    ws.addEventListener('message', handleMessage)
    ws.addEventListener('close', handleClose)
    ws.addEventListener('error', handleError)

    return () => {
      ws.removeEventListener('open', handleOpen)
      ws.removeEventListener('message', handleMessage)
      ws.removeEventListener('close', handleClose)
      ws.removeEventListener('error', handleError)
      ws.close()
    }
  }, [handleOpen, handleMessage, handleClose, handleError])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { isConnected, send, lastMessage }
}
