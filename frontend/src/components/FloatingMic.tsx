'use client'

import type { UseVoiceReturn } from '@/hooks/useVoice'

interface FloatingMicProps {
  voice: UseVoiceReturn
  isProcessing: boolean
  onMicClick: () => void
}

export default function FloatingMic({ voice, isProcessing, onMicClick }: FloatingMicProps) {
  if (!voice.supported) return null

  return (
    <button
      onClick={onMicClick}
      disabled={isProcessing && !voice.isListening && !voice.isSpeaking}
      className="absolute bottom-4 left-4 z-[500] w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all"
      title={
        voice.isListening
          ? 'Stop listening'
          : voice.isSpeaking
            ? 'Stop speaking'
            : 'Voice input'
      }
      style={{
        background: voice.isListening
          ? 'rgba(200,50,50,.9)'
          : voice.isSpeaking
            ? 'rgba(196,178,94,.85)'
            : 'var(--bg-raised)',
        border: `2px solid ${
          voice.isListening
            ? 'rgba(220,60,60,.6)'
            : voice.isSpeaking
              ? 'var(--gold-border)'
              : 'var(--border-strong)'
        }`,
        color: voice.isListening || voice.isSpeaking ? '#fff' : 'var(--text-muted)',
        boxShadow: voice.isListening
          ? '0 0 16px rgba(220,60,60,.5)'
          : voice.isSpeaking
            ? '0 0 16px rgba(196,178,94,.4)'
            : '0 4px 16px rgba(42,26,16,.25)',
      }}
    >
      {voice.isListening ? '⏹' : voice.isSpeaking ? '🔊' : '🎙️'}
    </button>
  )
}