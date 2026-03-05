'use client'
import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'

interface LazyYouTubeEmbedProps {
  ytId: string
}

/**
 * Lazy YouTube embed — only mounts the <iframe> (and its WebGL context)
 * when the element enters the viewport. Destroys it when it scrolls away.
 * This prevents the "Too many active WebGL contexts" warning that occurs
 * when many YouTube embeds are alive simultaneously.
 */
export default function LazyYouTubeEmbed({ ytId }: LazyYouTubeEmbedProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [activated, setActivated] = useState(false)
  const [thumbError, setThumbError] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const thumbUrl = `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`
  const embedUrl = `https://www.youtube.com/embed/${ytId}?autoplay=1`

  return (
    <span
      ref={containerRef}
      className="block my-2"
      style={{ maxWidth: 360 }}
    >
      {visible && activated ? (
        <iframe
          width="100%"
          height="200"
          src={embedUrl}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="rounded-xl"
          style={{ border: '1px solid var(--border)', display: 'block' }}
        />
      ) : (
        <span
          onClick={() => setActivated(true)}
          className="relative block rounded-xl overflow-hidden cursor-pointer"
          style={{
            width: '100%',
            height: 200,
            border: '1px solid var(--border)',
            background: '#000',
          }}
          title="Click to play"
        >
          {!thumbError ? (
            <img
              src={thumbUrl}
              alt="YouTube video thumbnail"
              onError={() => setThumbError(true)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: 0.85,
              }}
            />
          ) : (
            <span
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 6,
                color: 'rgba(255,255,255,0.45)',
                fontSize: 12,
              }}
            >
              <Icon name="video" size={28} />
              YouTube video
            </span>
          )}
          <span
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                width: 56,
                height: 40,
                background: 'rgba(255,0,0,0.85)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        </span>
      )}
    </span>
  )
}