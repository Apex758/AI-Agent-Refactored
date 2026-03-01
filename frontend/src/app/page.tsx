'use client'

import { useState, useRef, useEffect, FormEvent, useCallback } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { Document, Citation } from '@/types'

// ── File type icons ───────────────────────────────────────────────
function FileIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase()
  const colors: Record<string, string> = {
    pdf: 'text-red-400', docx: 'text-blue-400', doc: 'text-blue-400',
    txt: 'text-gray-400', md: 'text-purple-400', csv: 'text-green-400',
  }
  const labels: Record<string, string> = {
    pdf: 'PDF', docx: 'DOC', doc: 'DOC', txt: 'TXT', md: 'MD', csv: 'CSV',
  }
  return (
    <span className={`text-xs font-bold font-mono ${colors[ext || ''] || 'text-gray-500'}`}>
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
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
        isCross
          ? 'border-amber-700/50 bg-amber-900/20 text-amber-400'
          : 'border-emerald-700/50 bg-emerald-900/20 text-emerald-400'
      }`}
      title={isCross ? 'From another chat' : 'From this chat'}
    >
      <span>📄</span>
      <span className="truncate max-w-[120px]">{citation.filename}</span>
      {citation.page > 1 && <span className="opacity-60">p.{citation.page}</span>}
      {isCross && <span className="opacity-60 text-[10px]">↗</span>}
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
  const [uploading, setUploading] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files)
    }
  }, [onUpload])

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 border-b border-gray-800">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Documents</p>
        <p className="text-xs text-gray-600 mt-0.5">Linked to this chat</p>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`mx-2 mt-2 rounded-xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center py-4 gap-1 ${
          isDragging
            ? 'border-emerald-500 bg-emerald-900/20'
            : 'border-gray-700 hover:border-gray-500 hover:bg-gray-800/50'
        }`}
      >
        <span className="text-xl">{isDragging ? '📂' : '📎'}</span>
        <p className="text-xs text-gray-500 text-center px-2">
          {isDragging ? 'Drop to upload' : 'Drop files or click'}
        </p>
        <p className="text-xs text-gray-700">PDF, DOCX, TXT, MD</p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.doc,.txt,.md,.rst,.csv"
        className="hidden"
        onChange={handleFileInput}
      />

      {/* Error messages */}
      {errors.length > 0 && (
        <div className="mx-2 mt-1">
          {errors.map((err, i) => (
            <p key={i} className="text-xs text-red-400 py-0.5">{err}</p>
          ))}
        </div>
      )}

      {/* Document list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pt-1 pb-2 space-y-1 mt-1">
        {documents.length === 0 && (
          <p className="text-xs text-gray-700 text-center mt-4">No documents yet</p>
        )}
        {documents.map(doc => (
          <div
            key={doc.doc_id}
            className="group flex items-start gap-2 p-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition"
          >
            <div className="flex-shrink-0 w-8 h-8 rounded bg-gray-700/50 flex items-center justify-center">
              <FileIcon filename={doc.filename} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-200 truncate font-medium" title={doc.filename}>
                {doc.filename}
              </p>
              <p className="text-xs text-gray-600">
                {formatBytes(doc.file_size)} · {doc.chunk_count} chunks
              </p>
            </div>
            <button
              onClick={() => onDelete(doc.doc_id)}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-red-900/50 text-gray-500 hover:text-red-400 transition text-xs"
              title="Delete document"
            >
              ✕
            </button>
          </div>
        ))}

        {/* Uploading placeholders */}
        {uploading.map(name => (
          <div key={name} className="flex items-center gap-2 p-2 rounded-lg bg-gray-800/50">
            <div className="w-8 h-8 rounded bg-gray-700/50 flex items-center justify-center">
              <span className="text-xs text-gray-500 animate-pulse">...</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400 truncate">{name}</p>
              <p className="text-xs text-emerald-600">Indexing...</p>
            </div>
          </div>
        ))}
      </div>
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

  const currentMessages = currentChatId ? (messagesByChatId[currentChatId] || []) : []
  const currentDocuments = currentChatId ? (documentsByChatId[currentChatId] || []) : []
  const { send } = useWebSocket(currentChatId || '')

  const [input, setInput] = useState('')
  const [showMemory, setShowMemory] = useState(false)
  const [memoryContent, setMemoryContent] = useState('')
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [docPanelOpen, setDocPanelOpen] = useState(true)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadConfig(); loadChats() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [currentMessages, streamingContent])
  useEffect(() => { if (editingChatId) editInputRef.current?.focus() }, [editingChatId])

  const handleSend = (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isProcessing || !currentChatId) return
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
      try {
        await uploadDocument(file, currentChatId)
      } catch (e: any) {
        errs.push(`${file.name}: ${e.message}`)
      }
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

  return (
    <main className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* ── Left: Chat sidebar ── */}
      <aside className={`${sidebarOpen ? 'w-56' : 'w-0'} transition-all duration-200 overflow-hidden flex-shrink-0 flex flex-col border-r border-gray-800 bg-gray-900`}>
        <div className="p-3 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center text-xs font-bold flex-shrink-0">{agentName[0]?.toUpperCase()}</div>
          <span className="font-semibold text-sm flex-1">{agentName}</span>
          <button
            onClick={() => createChat()}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition text-lg"
            title="New chat"
          >+</button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2 space-y-0.5">
          {chats.length === 0 && <p className="text-xs text-gray-600 text-center mt-8">No chats yet</p>}
          {chats.map(chat => (
            <div
              key={chat.id}
              onClick={() => setCurrentChat(chat.id)}
              className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition ${
                chat.id === currentChatId ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              {editingChatId === chat.id ? (
                <input
                  ref={editInputRef}
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => handleRename(chat.id)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRename(chat.id); if (e.key === 'Escape') setEditingChatId(null) }}
                  onClick={e => e.stopPropagation()}
                  className="flex-1 bg-gray-600 text-white text-xs rounded px-1 py-0.5 outline-none"
                />
              ) : (
                <>
                  <span className="flex-1 text-xs truncate">{chat.name}</span>
                  <span className="text-gray-600 text-xs flex-shrink-0 group-hover:hidden">{formatTime(chat.created_at)}</span>
                  <div className="hidden group-hover:flex gap-1">
                    <button onClick={e => startEdit(e, chat)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-600 text-xs">✎</button>
                    <button onClick={e => { e.stopPropagation(); deleteChat(chat.id) }} className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-800 text-xs text-red-400">✕</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* ── Center: Chat area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-800 text-gray-500 hover:text-white transition text-sm"
            >☰</button>
            <span className="text-sm font-medium text-gray-300 truncate max-w-xs">
              {currentChatId ? (chats.find(c => c.id === currentChatId)?.name || 'Chat') : 'Select a chat'}
            </span>
          </div>
          <div className="flex gap-2 items-center">
            {currentChatId && (
              <>
                <button onClick={loadMemory} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg transition">Memory</button>
                <button onClick={clearChat} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg transition">Clear</button>
              </>
            )}
            <button
              onClick={() => setDocPanelOpen(o => !o)}
              className={`px-3 py-1.5 text-xs border rounded-lg transition flex items-center gap-1 ${
                docPanelOpen ? 'text-emerald-400 border-emerald-700/50 bg-emerald-900/20' : 'text-gray-400 border-gray-700 hover:text-white'
              }`}
              title="Toggle document panel"
            >
              📎 {currentDocuments.length > 0 && <span className="bg-emerald-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">{currentDocuments.length}</span>}
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4 space-y-4">
          {!currentChatId ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-600">
              <p className="text-sm">Create a new chat to get started</p>
              <button onClick={() => createChat()} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-xl hover:bg-emerald-500 transition">New Chat</button>
            </div>
          ) : currentMessages.length === 0 && !streamingContent ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">Send a message to start...</div>
          ) : (
            <>
              {currentMessages.map(msg => (
                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user' ? 'bg-emerald-600 text-white'
                    : msg.role === 'system' ? 'bg-gray-800 text-gray-400 text-sm italic'
                    : 'bg-gray-800 text-gray-100'
                  }`}>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                  </div>
                  {/* Citation badges below assistant messages */}
                  {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 max-w-[80%]">
                      {msg.citations.map((c, i) => <CitationBadge key={i} citation={c} />)}
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming message */}
              {streamingContent && (
                <div className="flex flex-col items-start">
                  <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-gray-800 text-gray-100">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{streamingContent}<span className="animate-pulse">▌</span></p>
                  </div>
                </div>
              )}

              {isProcessing && !streamingContent && (
                <div className="flex justify-start">
                  <div className="bg-gray-800 rounded-2xl px-4 py-3">
                    <div className="flex gap-1.5">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="w-2 h-2 bg-gray-500 rounded-full" style={{ animation: `pulse-dot 1.4s ease-in-out ${i * 0.2}s infinite` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="flex justify-center">
              <div className="bg-red-900/30 text-red-400 text-sm rounded-lg px-4 py-2">{error}</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="px-6 py-4 border-t border-gray-800 flex-shrink-0">
          {uploadError && (
            <p className="text-xs text-red-400 mb-2 truncate">{uploadError}</p>
          )}
          <div className="flex gap-3">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={currentChatId ? 'Message Atlas...' : 'Create or select a chat first'}
              disabled={isProcessing || !currentChatId}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-50 placeholder-gray-500"
            />
            <button
              type="submit"
              disabled={isProcessing || !input.trim() || !currentChatId}
              className="px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 transition text-sm font-medium"
            >Send</button>
          </div>
        </form>
      </div>

      {/* ── Right: Document panel ── */}
      {currentChatId && (
        <aside className={`${docPanelOpen ? 'w-56' : 'w-0'} transition-all duration-200 overflow-hidden flex-shrink-0 border-l border-gray-800 bg-gray-900`}>
          <DocumentPanel
            chatId={currentChatId}
            documents={currentDocuments}
            onDelete={(docId) => deleteDocument(docId, currentChatId)}
            onUpload={handleUpload}
          />
        </aside>
      )}

      {/* Memory Modal */}
      {showMemory && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowMemory(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto m-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Chat Memory</h2>
              <button onClick={() => setShowMemory(false)} className="text-gray-500 hover:text-white">✕</button>
            </div>
            <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">{memoryContent}</pre>
          </div>
        </div>
      )}
    </main>
  )
}