'use client'

import { useEffect, useState, useRef } from 'react'
import type { PlaybackState } from '@/types/whiteboard-sync'
import type { UIMode } from './types'

interface SubtitleOverlayProps {
  text: string            // current subtitle text (one full line)
  playback: PlaybackState
  mode: UIMode            // current UI mode to control visibility
}

export default function SubtitleOverlay({ text, playback, mode }: SubtitleOverlayProps) {
  const [visible, setVisible] = useState(false)
  const [displayText, setDisplayText] = useState('')
  const [opacity, setOpacity] = useState(0)
  const prevIndexRef = useRef(-1)

  // Handle subtitle transitions — fade in new text, fade out between lines
  useEffect(() => {
    if (text && playback.isPlaying) {
      // New subtitle line arrived
      if (playback.currentIndex !== prevIndexRef.current) {
        // Fade out briefly
        setOpacity(0)
        const fadeInTimer = setTimeout(() => {
          setDisplayText(text)
          setOpacity(1)
          setVisible(true)
        }, 150)
        prevIndexRef.current = playback.currentIndex
        return () => clearTimeout(fadeInTimer)
      } else {
        setDisplayText(text)
        setOpacity(1)
        setVisible(true)
      }
    } else if (playback.isFading) {
      // Fading between subtitles
      setOpacity(0.3)
    } else if (!playback.isPlaying) {
      // Playback ended — fade out
      setOpacity(0)
      const hideTimer = setTimeout(() => {
        setVisible(false)
        setDisplayText('')
      }, 500)
      return () => clearTimeout(hideTimer)
    }
  }, [text, playback.isPlaying, playback.currentIndex, playback.isFading])

  // Hide subtitles when in chat mode (TTS still runs, just no visual)
  if (mode === 'chat') return null

  if (!visible && !displayText) return null

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

      {/* Subtitle text — one full line at a time */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(12px)',
          borderRadius: 14,
          padding: '14px 24px',
          border: '1px solid rgba(196, 178, 94, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          textAlign: 'center',
          opacity: opacity,
          transition: 'opacity 0.25s ease-in-out',
          minWidth: 200,
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
          {displayText}
        </p>
      </div>
    </div>
  )
}