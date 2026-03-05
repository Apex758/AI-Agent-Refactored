'use client'

import { ReactNode } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useWhiteboardStore } from '@/store/whiteboardStore'
import WhiteboardLayer from '@/components/whiteboard/WhiteboardLayer'
import SubtitleOverlay from '@/components/whiteboard/SubtitleOverlay'
import FloatingMic from '@/components/FloatingMic'
import Icon from '@/components/Icon'
import type { UseVoiceReturn } from '@/hooks/useVoice'
import type { UIMode } from '@/components/whiteboard/types'

interface CenterStageProps {
  chatId: string | null
  children: ReactNode
  headerLeft: ReactNode
  headerRight: ReactNode
  voice: UseVoiceReturn
  isProcessing: boolean
  onMicClick: () => void
  onAfterSnapshot?: () => void  // FIX 1: passed down to WhiteboardLayer
}

function ModeToggle({ mode, setMode, locked }: { mode: UIMode; setMode: (m: UIMode) => void; locked: boolean }) {
  return (
    <div
      className="flex rounded-lg overflow-hidden"
      style={{ border: '1.5px solid var(--border-strong)', background: 'var(--bg-raised)' }}
    >
      {(['chat', 'whiteboard'] as UIMode[]).map((m) => (
        <button
          key={m}
          onClick={(e) => {
            e.stopPropagation()
            if (!locked) setMode(m)
          }}
          className="px-3 py-1.5 text-xs font-medium transition-all capitalize"
          style={{
            background: mode === m ? 'var(--seal-brown)' : 'transparent',
            color: mode === m ? 'var(--text-inverse)' : locked ? 'var(--text-disabled, #666)' : 'var(--text-secondary)',
            cursor: locked ? 'not-allowed' : 'pointer',
            opacity: locked ? 0.6 : 1,
          }}
          disabled={locked}
        >
          {m === 'chat' ? <><Icon name="chat" size={14} /> Chat</> : <><Icon name="palette" size={14} /> Board</>}
        </button>
      ))}
    </div>
  )
}

export default function CenterStage({
  chatId,
  children,
  headerLeft,
  headerRight,
  voice,
  isProcessing,
  onMicClick,
  onAfterSnapshot,
}: CenterStageProps) {
  const { mode, setMode, locked, toggleLock } = useUIStore()
  const { saveSnapshot, currentSubtitle, playbackState } = useWhiteboardStore()

  const handleSetMode = (newMode: UIMode) => {
    if (locked) return
    if (mode === 'whiteboard' && newMode === 'chat' && chatId) {
      saveSnapshot(chatId)
    }
    setMode(newMode)
  }

  return (
    <div className="h-full flex flex-col min-w-0 relative">
      {/* Header */}
      <header className="chat-header flex items-center justify-between px-5 py-3 flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          {headerLeft}
        </div>

        {chatId && (
          <div className="flex items-center gap-2">
            <ModeToggle mode={mode} setMode={handleSetMode} locked={locked} />
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleLock()
              }}
              className="p-1.5 rounded-lg transition-all"
              style={{
                background: locked ? 'var(--seal-brown)' : 'transparent',
                color: locked ? 'var(--text-inverse)' : 'var(--text-secondary)',
                border: '1.5px solid var(--border-strong)',
              }}
              title={locked ? 'Unlock tab' : 'Lock tab'}
            >
              <Icon name={locked ? 'lock' : 'unlock'} size={14} />
            </button>
          </div>
        )}

        <div className="flex gap-2 items-center">
          {headerRight}
        </div>
      </header>

      {/* Stacked layers */}
      <div className="flex-1 relative overflow-hidden">
        {/* Chat layer */}
        <div
          className="absolute inset-0 transition-opacity duration-300 ease-in-out"
          style={{
            opacity: mode === 'chat' ? 1 : 0,
            pointerEvents: mode === 'chat' ? 'auto' : 'none',
            zIndex: mode === 'chat' ? 2 : 1,
          }}
        >
          {children}
        </div>

        {/* Whiteboard layer */}
        {chatId && (
          <div
            className="absolute inset-0 transition-opacity duration-300 ease-in-out overflow-hidden"
            style={{
              opacity: mode === 'whiteboard' ? 1 : 0,
              pointerEvents: mode === 'whiteboard' ? 'auto' : 'none',
              zIndex: mode === 'whiteboard' ? 2 : 1,
            }}
          >
            {/* FIX 1: pass onAfterSnapshot through */}
            <WhiteboardLayer chatId={chatId} onAfterSnapshot={onAfterSnapshot} />

            {mode === 'whiteboard' && (
              <FloatingMic
                voice={voice}
                isProcessing={isProcessing}
                onMicClick={onMicClick}
              />
            )}
          </div>
        )}

        {/* Subtitle overlay — visible only in whiteboard mode during TTS playback */}
        <SubtitleOverlay text={currentSubtitle} playback={playbackState} mode={mode} />
      </div>
    </div>
  )
}