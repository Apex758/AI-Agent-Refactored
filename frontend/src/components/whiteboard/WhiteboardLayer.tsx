'use client'

import dynamic from 'next/dynamic'
import { useCallback, useState } from 'react'
import { useWhiteboardStore } from '@/store/whiteboardStore'
import { useChatStore } from '@/store/chatStore'
import MilestoneBar from '@/components/whiteboard/MilestoneBar'
import SubtitleOverlay from '@/components/whiteboard/SubtitleOverlay'
import Icon from '@/components/Icon'

const Whiteboard = dynamic(() => import('./Whiteboard'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>
      Loading whiteboard…
    </div>
  ),
})

interface WhiteboardLayerProps {
  chatId: string
  onAfterSnapshot?: () => void
}

export default function WhiteboardLayer({ chatId, onAfterSnapshot }: WhiteboardLayerProps) {
  const { exportAsImage, currentSubtitle, playbackState } = useWhiteboardStore()
  const { addMessage } = useChatStore()
  const [exporting, setExporting] = useState(false)

  const handleSnapshot = useCallback(async () => {
    setExporting(true)
    try {
      const blob = await exportAsImage()
      if (!blob) {
        alert('Nothing on the board to capture.')
        return
      }

      const reader = new FileReader()
      reader.onloadend = () => {
        const dataUrl = reader.result as string
        const msg = {
          id: Math.random().toString(36).slice(2, 12),
          role: 'user' as const,
          content: 'Whiteboard snapshot',
          timestamp: Date.now(),
          citations: [],
          attachment: {
            type: 'image' as const,
            dataUrl,
            name: `whiteboard-${Date.now()}.png`,
          },
        }
        addMessage(msg)
        onAfterSnapshot?.()
      }
      reader.readAsDataURL(blob)
    } catch (e) {
      console.error('Snapshot failed:', e)
    } finally {
      setExporting(false)
    }
  }, [exportAsImage, addMessage, onAfterSnapshot])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Whiteboard chatId={chatId} />

      {/* Snapshot button */}
      <button
        onClick={handleSnapshot}
        disabled={exporting}
        className="absolute bottom-4 right-4 z-[500] flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-all"
        style={{
          background: 'var(--seal-brown)',
          color: 'var(--text-inverse)',
          boxShadow: '0 4px 16px rgba(42,26,16,.35)',
          opacity: exporting ? 0.6 : 1,
          /* Shift left so it doesn't overlap the milestone bar */
          right: 52,
        }}
        title="Send board snapshot to chat"
      >
        <Icon name="camera" size={14} /> {exporting ? 'Exporting…' : 'Send to Chat'}
      </button>

      {/* Subtitle overlay for teaching mode playback */}
      <SubtitleOverlay text={currentSubtitle} playback={playbackState} />

      {/* Milestone progress bar — bottom right */}
      <MilestoneBar chatId={chatId} />
    </div>
  )
}