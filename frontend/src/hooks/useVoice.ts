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

  const recRef      = useRef<any>(null)
  const synthRef    = useRef<SpeechSynthesis | null>(null)
  const callbackRef = useRef(onFinalTranscript)
  const wsRef       = useRef<WebSocket | null>(null)
  const audioRef    = useRef<HTMLAudioElement | null>(null)

  useEffect(() => { callbackRef.current = onFinalTranscript }, [onFinalTranscript])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSupported(!!SR && !!window.speechSynthesis)
    synthRef.current = window.speechSynthesis ?? null
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
    
    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data)
      
      if (message.type === 'tts_audio') {
        const audioBytes = Uint8Array.from(atob(message.audio), c => c.charCodeAt(0))
        const blob = new Blob([audioBytes], { type: 'audio/wav' })
        const url = URL.createObjectURL(blob)
        
        if (audioRef.current) {
          audioRef.current.pause()
        }
        
        const audio = new Audio(url)
        audioRef.current = audio
        
        audio.onplay = () => setIsSpeaking(true)
        audio.onended = () => {
          setIsSpeaking(false)
          URL.revokeObjectURL(url)
        }
        audio.onerror = () => {
          setIsSpeaking(false)
          URL.revokeObjectURL(url)
        }
        
        await audio.play()
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
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    synthRef.current?.cancel()
    setIsSpeaking(false)
  }, [])

  const speak = useCallback((text: string) => {
    // Use the proper text cleaner utility
    const clean = cleanForTTS(text)
    if (!clean) return

    // Try server-side TTS first
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'tts',
        text: clean,
        speed: 1.0
      }))
    } else {
      // Fallback to browser TTS
      const synth = synthRef.current
      if (!synth) return
      synth.cancel()

      const utt = new SpeechSynthesisUtterance(clean)
      utt.rate = 1.05
      utt.pitch = 1.0

      const voices = synth.getVoices()
      const preferred = voices.find(v =>
        /Google|Samantha|Alex|Daniel|Karen|Moira|Fiona/i.test(v.name)
      )
      if (preferred) utt.voice = preferred

      utt.onstart = () => setIsSpeaking(true)
      utt.onend   = () => setIsSpeaking(false)
      utt.onerror = () => setIsSpeaking(false)

      synth.speak(utt)
    }
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