'use client'
import { useCallback, useRef, useState, useEffect } from 'react'
import { cleanForTTS } from '@/utils/textCleaner'

export interface UseVoiceReturn {
  isListening: boolean
  isSpeaking: boolean
  supported: boolean
  interimText: string
  startListening: () => void
  stopListening: () => void
  speak: (text: string) => void
  stopSpeaking: () => void
}

export function useVoice(onFinalTranscript: (text: string) => void): UseVoiceReturn {
  const [isListening, setIsListening]   = useState(false)
  const [isSpeaking, setIsSpeaking]     = useState(false)
  const [supported, setSupported]       = useState(false)
  const [interimText, setInterimText]   = useState('')

  const recRef         = useRef<any>(null)
  const callbackRef    = useRef(onFinalTranscript)
  const wsRef          = useRef<WebSocket | null>(null)
  const audioRef       = useRef<HTMLAudioElement | null>(null)
  const audioQueueRef  = useRef<string[]>([])   // object URLs waiting to play
  const isPlayingRef   = useRef(false)

  useEffect(() => { callbackRef.current = onFinalTranscript }, [onFinalTranscript])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSupported(!!SR)
  }, [])

  // Initialize WebSocket connection for server-side TTS
  useEffect(() => {
    if (typeof window === 'undefined') return
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL
    if (!wsUrl) return

    const ws = new WebSocket(`${wsUrl}/webrtc`)
    
    ws.onopen = () => {
      console.log('TTS WebSocket connected')
    }
    
    // Play the next URL in the queue (called recursively until empty)
    const playNext = () => {
      if (audioQueueRef.current.length === 0) {
        isPlayingRef.current = false
        setIsSpeaking(false)
        audioRef.current = null
        return
      }
      isPlayingRef.current = true
      setIsSpeaking(true)
      const url = audioQueueRef.current.shift()!
      const audio = new Audio(url)
      audioRef.current = audio
      const onDone = () => { URL.revokeObjectURL(url); playNext() }
      audio.onended = onDone
      audio.onerror = onDone
      audio.play().catch(onDone)
    }

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.type === 'tts_audio') {
        const audioBytes = Uint8Array.from(atob(message.audio), c => c.charCodeAt(0))
        const blob = new Blob([audioBytes], { type: 'audio/wav' })
        const url = URL.createObjectURL(blob)
        audioQueueRef.current.push(url)
        if (!isPlayingRef.current) playNext()
      } else if (message.type === 'tts_error') {
        console.error('TTS error:', message.message)
        setIsSpeaking(false)
      }
    }
    
    ws.onerror = (error) => {
      console.error('TTS WebSocket error:', error)
    }
    
    ws.onclose = () => {
      console.log('TTS WebSocket closed')
    }
    
    wsRef.current = ws
    
    return () => {
      ws.close()
    }
  }, [])

  // ── TTS ──────────────────────────────────────────────────────────

  const stopSpeaking = useCallback(() => {
    // Clear the queue so no more sentences play
    audioQueueRef.current = []
    isPlayingRef.current = false
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setIsSpeaking(false)
  }, [])

  const speak = useCallback((text: string) => {
    // Use the proper text cleaner utility
    const clean = cleanForTTS(text)
    if (!clean) return

    // Send to Piper TTS via the /webrtc WebSocket
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'tts',
        text: clean,
        speed: 1.0
      }))
    }
    // No browser TTS fallback — Piper only
  }, [])

  // ── STT ──────────────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    recRef.current?.stop()
    setIsListening(false)
    setInterimText('')
  }, [])

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return

    stopSpeaking()

    const rec = new SR()
    rec.continuous     = false
    rec.interimResults = true
    rec.lang           = 'en-US'

    rec.onresult = (e: any) => {
      const result     = e.results[e.results.length - 1]
      const transcript = result[0].transcript as string

      if (result.isFinal) {
        setInterimText('')
        setIsListening(false)
        const trimmed = transcript.trim()
        if (trimmed) callbackRef.current(trimmed)
      } else {
        setInterimText(transcript)
      }
    }

    rec.onspeechend = () => rec.stop()
    rec.onend       = () => { setIsListening(false); setInterimText('') }
    rec.onerror     = () => { setIsListening(false); setInterimText('') }

    recRef.current = rec
    rec.start()
    setIsListening(true)
  }, [stopSpeaking])

  return {
    isListening,
    isSpeaking,
    supported,
    interimText,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  }
}