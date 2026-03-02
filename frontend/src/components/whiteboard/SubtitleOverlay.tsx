'use client'

import { useEffect, useState } from 'react'
import type { PlaybackState } from '@/types/whiteboard-sync'

interface SubtitleOverlayProps {
  text: string            // current subtitle text
  playback: PlaybackState
}

export default function SubtitleOverlay({ text, playback }: SubtitleOverlayProps) {
  const [visible, setVisible] = useState(false)
  const [displayWords, setDisplayWords] = useState<string[]>([])
  const [fadeKey, setFadeKey] = useState(0) // Used to trigger fade animations

  // Update display when words change
  useEffect(() => {
    if (playback.visibleWords && playback.visibleWords.length > 0) {
      setDisplayWords(playback.visibleWords)
    } else if (text) {
      // Fallback: split text into words
      setDisplayWords(text.split(/\s+/).filter(w => w))
    } else {
      setDisplayWords([])
    }
  }, [playback.visibleWords, text])

  // Trigger fade animation when transitioning between words
  useEffect(() => {
    if (playback.isFading) {
      setFadeKey(k => k + 1)
    }
  }, [playback.isFading, playback.currentWordIndex])

  useEffect(() => {
    if (text && playback.isPlaying) {
      setVisible(true)
    } else if (!playback.isPlaying) {
      // Fade out after playback ends
      const timer = setTimeout(() => setVisible(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [text, playback.isPlaying])

  if (!visible && displayWords.length === 0) return null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 64,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 700,
        maxWidth: '80%',
        pointerEvents: 'none',
      }}
    >
      {/* Progress dots */}
      {playback.isPlaying && playback.totalSubtitles > 1 && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 4,
          marginBottom: 8,
        }}>
          {Array.from({ length: playback.totalSubtitles }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: i <= playback.currentIndex
                  ? 'var(--vegas-gold)'
                  : 'rgba(255,255,255,0.25)',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>
      )}

      {/* Subtitle text with word-by-word display */}
      <div
        key={fadeKey} // Key change triggers fade animation
        style={{
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(12px)',
          borderRadius: 14,
          padding: '14px 24px',
          border: '1px solid rgba(196, 178, 94, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          textAlign: 'center',
          opacity: displayWords.length > 0 ? 1 : 0,
          transition: 'opacity 0.15s ease-out', // Quick fade for word transitions
        }}
      >
        <p style={{
          color: '#f1f5f9',
          fontSize: 16,
          lineHeight: 1.6,
          margin: 0,
          fontWeight: 400,
          letterSpacing: '0.01em',
        }}>
          {displayWords.map((word, index) => {
            const isCurrentWord = playback.currentWordIndex === index
            const isPastWord = index < playback.currentWordIndex
            
            return (
              <span
                key={index}
                style={{
                  display: 'inline-block',
                  marginRight: '0.25em',
                  // Highlight current word being spoken
                  color: isCurrentWord
                    ? 'var(--vegas-gold)'
                    : isPastWord
                      ? '#e2e8f0'
                      : '#94a3b8',
                  fontWeight: isCurrentWord ? 600 : 400,
                  transform: isCurrentWord ? 'scale(1.05)' : 'scale(1)',
                  transition: 'color 0.1s, transform 0.1s, opacity 0.15s',
                  opacity: playback.isFading && isPastWord ? 0.7 : 1,
                }}
              >
                {word}
              </span>
            )
          })}
        </p>
      </div>
    </div>
  )
}