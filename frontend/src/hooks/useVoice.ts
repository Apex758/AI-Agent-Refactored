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

/**
 * Voice hook — browser-only TTS + STT.
 *
 * TTS uses the Web Speech API which has a built-in utterance queue.
 * Multiple speak() calls play back-to-back without cancelling each other.
 * Only stopSpeaking() cancels the queue.
 */
export function useVoice(
  onFinalTranscript: (text: string) => void,
): UseVoiceReturn {
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking]   = useState(false)
  const [supported, setSupported]     = useState(false)
  const [interimText, setInterimText] = useState('')

  const recRef             = useRef<any>(null)
  const callbackRef        = useRef(onFinalTranscript)
  const pendingCountRef    = useRef(0)
  const stopFlagRef        = useRef(false)
  const preferredVoiceRef  = useRef<SpeechSynthesisVoice | null>(null)

  useEffect(() => { callbackRef.current = onFinalTranscript }, [onFinalTranscript])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSupported(!!SR)

    // Pre-cache the best English voice
    const pickVoice = () => {
      const voices = window.speechSynthesis?.getVoices() || []
      preferredVoiceRef.current =
        voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) ||
        voices.find(v => v.lang.startsWith('en') && !v.localService) ||
        voices.find(v => v.lang.startsWith('en')) ||
        null
    }
    pickVoice()
    window.speechSynthesis?.addEventListener('voiceschanged', pickVoice)
    return () => { window.speechSynthesis?.removeEventListener('voiceschanged', pickVoice) }
  }, [])

  // ── TTS ──────────────────────────────────────────────────────

  const stopSpeaking = useCallback(() => {
    stopFlagRef.current = true
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    pendingCountRef.current = 0
    setIsSpeaking(false)
    setTimeout(() => { stopFlagRef.current = false }, 50)
  }, [])

  const speak = useCallback((text: string) => {
    const clean = cleanForTTS(text)
    if (!clean || stopFlagRef.current) return
    if (typeof window === 'undefined' || !window.speechSynthesis) return

    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.rate  = 1.0
    utterance.pitch = 1.0
    utterance.lang  = 'en-US'
    if (preferredVoiceRef.current) utterance.voice = preferredVoiceRef.current

    pendingCountRef.current++
    setIsSpeaking(true)

    utterance.onend = () => {
      pendingCountRef.current = Math.max(0, pendingCountRef.current - 1)
      if (pendingCountRef.current === 0) setIsSpeaking(false)
    }
    utterance.onerror = () => {
      pendingCountRef.current = Math.max(0, pendingCountRef.current - 1)
      if (pendingCountRef.current === 0) setIsSpeaking(false)
    }

    // Web Speech API queues utterances automatically — no cancel needed
    window.speechSynthesis.speak(utterance)
  }, [])

  // ── STT ──────────────────────────────────────────────────────

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