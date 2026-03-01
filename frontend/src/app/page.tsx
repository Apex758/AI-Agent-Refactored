'use client'

import { useState, useRef, useEffect, FormEvent, useCallback } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useVoice } from '@/hooks/useVoice'
import type { Document, Citation } from '@/types'

// ── URL → clickable links ─────────────────────────────────────────
function MessageContent({ content }: { content: string }) {
  const URL_RE = /https?:\/\/[^\s)>\]"']+/g
  const parts: Array<{ type: 'text' | 'url'; value: string }> = []
  let last = 0
  let match: RegExpExecArray | null

  while ((match = URL_RE.exec(content)) !== null) {
    if (match.index > last) parts.push({ type: 'text', value: content.slice(last, match.index) })
    parts.push({ type: 'url', value: match[0] })
    last = URL_RE.lastIndex
  }
  if (last < content.length) parts.push({ type: 'text', value: content.slice(last) })

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'url') {
          let label = p.value
          try {
            const u = new URL(p.value)
            const path = u.pathname !== '/' ? u.pathname.replace(/\/$/, '').split('/').pop() || '' : ''
            label = u.hostname.replace(/^www\./, '') + (path ? `/${path}` : '')
            if (label.length > 40) label = label.slice(0, 38) + '…'
          } catch { /* keep raw url */ }
          return (
            <a
              key={i}
              href={p.value}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 font-medium transition-opacity hover:opacity-80"
              style={{ color: 'var(--vegas-gold)' }}
            >
              {label} ↗
            </a>
          )
        }
        return <span key={i}>{p.value}</span>
      })}
    </>
  )
}

// ── File type icons ───────────────────────────────────────────────
function FileIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase()
  const colors: Record<string, string> = {
    pdf: 'text-red-400', docx: 'text-blue-300', doc: 'text-blue-300',
    txt: 'text-gray-300', md: 'text-purple-300', csv: 'text-green-300',
  }
  const labels: Record<string, string> = {
    pdf: 'PDF', docx: 'DOC', doc: 'DOC', txt: 'TXT', md: 'MD', csv: 'CSV',
  }
  return (
    <span className={`text-xs font-bold font-mono ${colors[ext || ''] || 'text-gray-400'}`}>
      {labels[ext || ''] || ext?.toUpperCase() || 'FILE'}
    </span>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// ── Citation badge ────────────────────────────────────────────────
function CitationBadge({ citation }: { citation: Citation }) {
  const isCross = citation.source_type === 'cross_chat_doc'
  return (
    <span
      className={isCross ? 'citation-badge citation-badge-cross' : 'citation-badge'}
      title={isCross ? 'From another chat' : 'From this chat'}
    >
      📄{' '}
      <span className="truncate max-w-[120px] inline-block align-bottom">{citation.filename}</span>
      {citation.page > 1 && <span style={{ opacity: 0.6 }}> p.{citation.page}</span>}
      {isCross && <span style={{ opacity: 0.55, fontSize: 10 }}> ↗</span>}
    </span>
  )
}

// ── Document panel ────────────────────────────────────────────────
function DocumentPanel({
  chatId,
  documents,
  onDelete,
  onUpload,
}: {
  chatId: string
  documents: Document[]
  onDelete: (docId: string) => void
  onUpload: (files: FileList) => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) onUpload(e.dataTransfer.files)
  }, [onUpload])

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
  }

  return (
    <div className="doc-panel flex flex-col h-full">
      <div className="px-3 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <p className="font-display text-xs uppercase" style={{ color: 'var(--vegas-gold)', letterSpacing: '0.12em' }}>
          Documents
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(245,240,235,.4)' }}>Linked to this chat</p>
      </div>

      <div className="px-2 pt-3">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`drop-zone${isDragging ? ' dragging' : ''} flex flex-col items-center justify-center py-4 gap-1`}
        >
          <span className="text-xl">{isDragging ? '📂' : '📎'}</span>
          <p className="text-xs text-center px-2" style={{ color: 'rgba(245,240,235,.5)' }}>
            {isDragging ? 'Drop to upload' : 'Drop files or click'}
          </p>
          <p className="text-xs" style={{ color: 'rgba(245,240,235,.25)' }}>PDF · DOCX · TXT · MD</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.txt,.md,.rst,.csv"
          className="hidden"
          onChange={e => e.target.files && e.target.files.length > 0 && onUpload(e.target.files)}
        />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pt-2 pb-3 space-y-1.5 mt-1">
        {documents.length === 0 && (
          <p className="text-xs text-center mt-6" style={{ color: 'rgba(245,240,235,.25)' }}>
            No documents yet
          </p>
        )}
        {documents.map(doc => (
          <div key={doc.doc_id} className="doc-item group flex items-start gap-2 p-2">
            <div
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,.1)' }}
            >
              <FileIcon filename={doc.filename} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs truncate font-medium" style={{ color: 'var(--text-inverse)' }} title={doc.filename}>
                {doc.filename}
              </p>
              <p className="text-xs" style={{ color: 'rgba(245,240,235,.4)' }}>
                {formatBytes(doc.file_size)} · {doc.chunk_count} chunks
              </p>
            </div>
            <button
              onClick={() => onDelete(doc.doc_id)}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition text-xs"
              style={{ color: 'rgba(245,240,235,.5)' }}
              title="Delete"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Voice indicator ───────────────────────────────────────────────
function VoiceOrb({ isListening, isSpeaking }: { isListening: boolean; isSpeaking: boolean }) {
  if (!isListening && !isSpeaking) return null
  return (
    <div
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none"
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: 64, height: 64 }}
      >
        {/* Pulse rings */}
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: 64 + i * 20,
              height: 64 + i * 20,
              border: `2px solid ${isListening ? 'rgba(220,60,60,.4)' : 'rgba(196,178,94,.35)'}`,
              animation: `pulse-ring 1.5s ease-out ${i * 0.4}s infinite`,
            }}
          />
        ))}
        <div
          className="relative w-14 h-14 rounded-full flex items-center justify-center text-2xl"
          style={{
            background: isListening ? 'rgba(200,50,50,.9)' : 'rgba(196,178,94,.85)',
            backdropFilter: 'blur(8px)',
            boxShadow: isListening
              ? '0 0 20px rgba(220,60,60,.5)'
              : '0 0 20px rgba(196,178,94,.4)',
          }}
        >
          {isListening ? '🎙️' : '🔊'}
        </div>
      </div>
      <p
        className="text-xs font-medium rounded-full px-3 py-1"
        style={{
          background: 'rgba(42,26,16,.7)',
          color: isListening ? 'rgba(255,130,120,1)' : 'var(--vegas-gold)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,.08)',
        }}
      >
        {isListening ? 'Listening…' : 'Speaking…'}
      </p>
      <style>{`
        @keyframes pulse-ring {
          0%   { transform: scale(0.9); opacity: 0.8; }
          100% { transform: scale(1.4); opacity: 0; }
        }
      `}</style>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function Home() {
  const {
    agentName, loadConfig,
    chats, currentChatId, messagesByChatId, documentsByChatId,
    isProcessing, streamingContent, error,
    loadChats, createChat, deleteChat, renameChat,
    setCurrentChat, sendMessage, clearChat,
    uploadDocument, deleteDocument,
  } = useChatStore()

  const currentMessages   = currentChatId ? (messagesByChatId[currentChatId] || []) : []
  const currentDocuments  = currentChatId ? (documentsByChatId[currentChatId] || []) : []
  const { send }          = useWebSocket(currentChatId || '')

  const [input, setInput]                 = useState('')
  const [showMemory, setShowMemory]       = useState(false)
  const [memoryContent, setMemoryContent] = useState('')
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editName, setEditName]           = useState('')
  const [sidebarOpen, setSidebarOpen]     = useState(true)
  const [docPanelOpen, setDocPanelOpen]   = useState(true)
  const [uploadError, setUploadError]     = useState<string | null>(null)
  const [voiceEnabled, setVoiceEnabled]   = useState(false)

  const bottomRef      = useRef<HTMLDivElement>(null)
  const editInputRef   = useRef<HTMLInputElement>(null)
  const lastSpokenId   = useRef<string | null>(null)
  const callbackRef    = useRef<(text: string) => void>(() => {})

  // ── Voice ──────────────────────────────────────────────────────
  // Keep a stable callback ref so useVoice's closure stays fresh
  const voice = useVoice(useCallback((text: string) => callbackRef.current(text), []))

  useEffect(() => {
    callbackRef.current = (text: string) => {
      if (!currentChatId || isProcessing) return
      setInput('')
      sendMessage(text)
      send(text)
    }
  }, [currentChatId, isProcessing, sendMessage, send])

  // Auto-speak new assistant messages
  useEffect(() => {
    if (!voiceEnabled) return
    const last = currentMessages[currentMessages.length - 1]
    if (last?.role === 'assistant' && last.id !== lastSpokenId.current) {
      lastSpokenId.current = last.id
      voice.speak(last.content)
    }
  }, [currentMessages, voiceEnabled, voice])

  // Show interim transcript in input while listening
  useEffect(() => {
    if (voice.interimText) setInput(voice.interimText)
  }, [voice.interimText])

  // ── General ────────────────────────────────────────────────────
  useEffect(() => { loadConfig(); loadChats() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [currentMessages, streamingContent])
  useEffect(() => { if (editingChatId) editInputRef.current?.focus() }, [editingChatId])

  const handleChatAreaClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (
      target.closest('form') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('.bubble-user') ||
      target.closest('.bubble-assistant') ||
      target.closest('header')
    ) return
    setSidebarOpen(false)
    setDocPanelOpen(false)
  }, [])

  const handleSend = (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isProcessing || !currentChatId) return
    // Stop TTS when user sends a new message
    voice.stopSpeaking()
    sendMessage(input.trim())
    send(input.trim())
    setInput('')
  }

  const handleRename = async (id: string) => {
    if (editName.trim()) await renameChat(id, editName.trim())
    setEditingChatId(null)
  }

  const startEdit = (e: React.MouseEvent, chat: { id: string; name: string }) => {
    e.stopPropagation()
    setEditingChatId(chat.id)
    setEditName(chat.name)
  }

  const handleUpload = async (files: FileList) => {
    if (!currentChatId) return
    setUploadError(null)
    const errs: string[] = []
    for (const file of Array.from(files)) {
      try { await uploadDocument(file, currentChatId) }
      catch (e: any) { errs.push(`${file.name}: ${e.message}`) }
    }
    if (errs.length > 0) setUploadError(errs.join('\n'))
  }

  const loadMemory = async () => {
    if (!currentChatId) return
    try {
      const res = await fetch(`/api/chats/${currentChatId}/memory`)
      const data = await res.json()
      setMemoryContent(data.content || 'No memory yet.')
      setShowMemory(true)
    } catch {
      setMemoryContent('Failed to load memory.')
      setShowMemory(true)
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000)
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const handleMicClick = () => {
    if (voice.isListening) {
      voice.stopListening()
    } else if (voice.isSpeaking) {
      voice.stopSpeaking()
    } else {
      setVoiceEnabled(true)
      voice.startListening()
    }
  }

  return (
    <main className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-main)' }}>

      {/* ── Hover-to-open sentinel — left edge ── */}
      {!sidebarOpen && (
        <div
          className="fixed left-0 top-0 h-full z-50"
          style={{ width: 12 }}
          onMouseEnter={() => setSidebarOpen(true)}
        />
      )}

      {/* ── Hover-to-open sentinel — right edge ── */}
      {!docPanelOpen && currentChatId && (
        <div
          className="fixed right-0 top-0 h-full z-50"
          style={{ width: 12 }}
          onMouseEnter={() => setDocPanelOpen(true)}
        />
      )}

      {/* ── Voice orb ── */}
      <VoiceOrb isListening={voice.isListening} isSpeaking={voice.isSpeaking} />

      {/* ── Left sidebar (emerald) ── */}
      <aside
        className="sidebar sidebar-collapse flex-shrink-0 flex flex-col"
        style={{ width: sidebarOpen ? 224 : 0 }}
      >
        {/* Brand */}
        <div
          className="p-4 flex items-center gap-3 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}
        >
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold font-display flex-shrink-0"
            style={{ background: 'var(--vegas-gold)', color: 'var(--seal-brown)' }}
          >
            {agentName[0]?.toUpperCase()}
          </div>
          <span className="font-display text-base flex-1 truncate" style={{ color: 'var(--text-inverse)' }}>
            {agentName}
          </span>
          <button
            onClick={() => createChat()}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition text-xl font-light"
            style={{ color: 'rgba(245,240,235,.6)', background: 'transparent' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            title="New chat"
          >
            +
          </button>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2 space-y-0.5">
          {chats.length === 0 && (
            <p className="text-xs text-center mt-8" style={{ color: 'rgba(245,240,235,.3)' }}>
              No chats yet
            </p>
          )}
          {chats.map(chat => {
            const isActive = chat.id === currentChatId
            return (
              <div
                key={chat.id}
                onClick={() => setCurrentChat(chat.id)}
                className={`sidebar-item${isActive ? ' active' : ''} group flex items-center gap-2 px-2 py-2 cursor-pointer`}
              >
                {isActive && <span className="chat-active-indicator h-4" />}
                {editingChatId === chat.id ? (
                  <input
                    ref={editInputRef}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => handleRename(chat.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(chat.id)
                      if (e.key === 'Escape') setEditingChatId(null)
                    }}
                    onClick={e => e.stopPropagation()}
                    className="flex-1 text-xs rounded px-1.5 py-0.5 outline-none"
                    style={{ background: 'rgba(255,255,255,.15)', color: 'var(--text-inverse)', border: 'none' }}
                  />
                ) : (
                  <>
                    <span className="flex-1 text-xs truncate">{chat.name}</span>
                    <span
                      className="text-xs flex-shrink-0 group-hover:hidden"
                      style={{ color: 'rgba(245,240,235,.3)' }}
                    >
                      {formatTime(chat.created_at)}
                    </span>
                    <div className="hidden group-hover:flex gap-1">
                      <button
                        onClick={e => startEdit(e, chat)}
                        className="w-5 h-5 flex items-center justify-center rounded text-xs"
                        style={{ color: 'rgba(245,240,235,.6)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.15)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >✎</button>
                      <button
                        onClick={e => { e.stopPropagation(); deleteChat(chat.id) }}
                        className="w-5 h-5 flex items-center justify-center rounded text-xs"
                        style={{ color: 'rgba(255,120,100,.7)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,100,80,.15)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >✕</button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </aside>

      {/* ── Center: Chat area ── */}
      <div className="flex-1 flex flex-col min-w-0" onClick={handleChatAreaClick}>

        {/* Header */}
        <header className="chat-header flex items-center justify-between px-5 py-3 flex-shrink-0 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={e => { e.stopPropagation(); setSidebarOpen(o => !o) }}
              className="btn-outline w-8 h-8 flex items-center justify-center text-sm"
              title="Toggle sidebar"
            >☰</button>
            <span
              className="text-sm font-medium truncate max-w-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              {currentChatId
                ? (chats.find(c => c.id === currentChatId)?.name || 'Chat')
                : 'Select a chat'}
            </span>
          </div>

          <div className="flex gap-2 items-center">
            {currentChatId && (
              <>
                <button
                  onClick={e => { e.stopPropagation(); loadMemory() }}
                  className="btn-outline px-3 py-1.5 text-xs"
                >Memory</button>
                <button
                  onClick={e => { e.stopPropagation(); clearChat() }}
                  className="btn-outline px-3 py-1.5 text-xs"
                >Clear</button>
              </>
            )}
            <button
              onClick={e => { e.stopPropagation(); setDocPanelOpen(o => !o) }}
              className="px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition"
              style={docPanelOpen ? {
                background: 'var(--gold-muted)',
                border: '1.5px solid var(--gold-border)',
                color: 'var(--seal-brown)',
              } : {
                border: '1.5px solid var(--border-strong)',
                color: 'var(--text-secondary)',
                background: 'transparent',
              }}
              title="Toggle documents"
            >
              📎
              {currentDocuments.length > 0 && (
                <span
                  className="text-white rounded-full w-4 h-4 flex items-center justify-center"
                  style={{ background: 'var(--seal-brown)', fontSize: 10 }}
                >
                  {currentDocuments.length}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-4">
          {!currentChatId ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center font-display text-3xl mb-1"
                style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >
                {agentName[0]?.toUpperCase()}
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                Start a new conversation
              </p>
              <button
                onClick={e => { e.stopPropagation(); createChat() }}
                className="btn-send px-5 py-2.5 text-sm"
              >
                New Chat
              </button>
            </div>
          ) : currentMessages.length === 0 && !streamingContent ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Send a message to start…
              </p>
            </div>
          ) : (
            <>
              {currentMessages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[78%] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bubble-user'
                        : msg.role === 'system'
                        ? 'bubble-assistant italic'
                        : 'bubble-assistant'
                    }`}
                  >
                    <MessageContent content={msg.content} />
                  </div>
                  {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5 max-w-[78%]">
                      {msg.citations.map((c, i) => <CitationBadge key={i} citation={c} />)}
                    </div>
                  )}
                </div>
              ))}

              {streamingContent && (
                <div className="flex flex-col items-start">
                  <div className="bubble-assistant max-w-[78%] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                    <MessageContent content={streamingContent} />
                    <span className="stream-cursor" />
                  </div>
                </div>
              )}

              {isProcessing && !streamingContent && (
                <div className="flex justify-start">
                  <div className="bubble-assistant px-4 py-3">
                    <div className="flex gap-1.5 items-center h-5">
                      {[0, 1, 2].map(i => (
                        <span
                          key={i}
                          className="typing-dot"
                          style={{ animation: `pulse-dot 1.4s ease-in-out ${i * 0.2}s infinite` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="flex justify-center">
              <div
                className="text-sm rounded-xl px-4 py-2"
                style={{
                  background: 'rgba(88,31,11,.1)',
                  color: 'var(--seal-brown)',
                  border: '1px solid rgba(88,31,11,.2)',
                }}
              >
                {error}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <form
          onSubmit={handleSend}
          onClick={e => e.stopPropagation()}
          className="px-6 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {uploadError && (
            <p className="text-xs mb-2 truncate" style={{ color: 'var(--seal-brown)' }}>
              {uploadError}
            </p>
          )}
          <div className="flex gap-2 items-center">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={
                voice.isListening
                  ? 'Listening…'
                  : currentChatId
                  ? `Message ${agentName}…`
                  : 'Create or select a chat first'
              }
              disabled={isProcessing || !currentChatId}
              className="chat-input flex-1 px-4 py-3 text-sm disabled:opacity-50"
              style={voice.isListening ? { borderColor: 'rgba(220,60,60,.6)', boxShadow: '0 0 0 3px rgba(220,60,60,.12)' } : {}}
            />

            {/* Mic button */}
            {voice.supported && currentChatId && (
              <button
                type="button"
                onClick={handleMicClick}
                disabled={isProcessing && !voice.isListening && !voice.isSpeaking}
                className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-xl transition-all text-lg"
                title={
                  voice.isListening ? 'Stop listening'
                  : voice.isSpeaking ? 'Stop speaking'
                  : 'Voice input'
                }
                style={{
                  background: voice.isListening
                    ? 'rgba(200,50,50,.9)'
                    : voice.isSpeaking
                    ? 'rgba(196,178,94,.85)'
                    : 'var(--bg-raised)',
                  border: `1.5px solid ${
                    voice.isListening ? 'rgba(220,60,60,.6)'
                    : voice.isSpeaking ? 'var(--gold-border)'
                    : 'var(--border-strong)'
                  }`,
                  color: (voice.isListening || voice.isSpeaking) ? '#fff' : 'var(--text-muted)',
                  boxShadow: voice.isListening
                    ? '0 0 12px rgba(220,60,60,.4)'
                    : voice.isSpeaking
                    ? '0 0 12px rgba(196,178,94,.3)'
                    : 'none',
                }}
              >
                {voice.isListening ? '⏹' : voice.isSpeaking ? '🔊' : '🎙️'}
              </button>
            )}

            {/* Voice auto-speak toggle */}
            {voice.supported && currentChatId && (
              <button
                type="button"
                onClick={() => {
                  const next = !voiceEnabled
                  setVoiceEnabled(next)
                  if (!next) voice.stopSpeaking()
                }}
                className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-xl transition-all text-xs font-semibold"
                title={voiceEnabled ? 'Disable auto-speak' : 'Enable auto-speak'}
                style={{
                  background: voiceEnabled ? 'var(--gold-muted)' : 'var(--bg-raised)',
                  border: `1.5px solid ${voiceEnabled ? 'var(--gold-border)' : 'var(--border-strong)'}`,
                  color: voiceEnabled ? 'var(--seal-brown)' : 'var(--text-muted)',
                }}
              >
                {voiceEnabled ? '🔈' : '🔇'}
              </button>
            )}

            <button
              type="submit"
              disabled={isProcessing || !input.trim() || !currentChatId}
              className="btn-send px-6 py-3 text-sm flex-shrink-0"
            >
              Send
            </button>
          </div>
        </form>
      </div>

      {/* ── Right: Doc panel (dark emerald) ── */}
      {currentChatId && (
        <aside
          className="sidebar-collapse flex-shrink-0"
          style={{ width: docPanelOpen ? 220 : 0 }}
        >
          <DocumentPanel
            chatId={currentChatId}
            documents={currentDocuments}
            onDelete={(docId) => deleteDocument(docId, currentChatId)}
            onUpload={handleUpload}
          />
        </aside>
      )}

      {/* ── Memory Modal ── */}
      {showMemory && (
        <div
          className="modal-backdrop fixed inset-0 flex items-center justify-center z-50"
          onClick={() => setShowMemory(false)}
        >
          <div
            className="modal-card p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto m-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-display text-xl" style={{ color: 'var(--text-primary)' }}>
                Chat Memory
              </h2>
              <button
                onClick={() => setShowMemory(false)}
                className="btn-outline w-8 h-8 flex items-center justify-center text-sm"
              >✕</button>
            </div>
            <pre
              className="text-sm leading-relaxed whitespace-pre-wrap font-mono"
              style={{ color: 'var(--text-secondary)' }}
            >
              {memoryContent}
            </pre>
          </div>
        </div>
      )}
    </main>
  )
}