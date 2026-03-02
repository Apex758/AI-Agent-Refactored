'use client'

import { useEffect, useState } from 'react'
import type { PlaybackState } from '@/types/whiteboard-sync'

interface SubtitleOverlayProps {
  text: string            // current subtitle text
  playback: PlaybackState
}

export default function SubtitleOverlay({ text, playback }: SubtitleOverlayProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (text && playback.isPlaying) {
      setVisible(true)
    } else if (!playback.isPlaying) {
      // Fade out after playback ends
      const timer = setTimeout(() => setVisible(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [text, playback.isPlaying])

  if (!visible && !text) return null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 64,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 700,
        maxWidth: '70%',
        pointerEvents: 'none',
      }}
    >
      {/* Progress dots */}
      {playback.isPlaying && playback.totalSubtitles > 1 && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 4,
          marginBottom: 6,
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

      {/* Subtitle text */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(12px)',
          borderRadius: 14,
          padding: '12px 20px',
          border: '1px solid rgba(196, 178, 94, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          textAlign: 'center',
          opacity: text ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      >
        <p style={{
          color: '#f1f5f9',
          fontSize: 15,
          lineHeight: 1.5,
          margin: 0,
          fontWeight: 400,
          letterSpacing: '0.01em',
        }}>
          {text}
        </p>
      </div>
    </div>
  )
}