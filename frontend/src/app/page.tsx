'use client'

import { useState, useRef, useEffect, FormEvent } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useWebSocket } from '@/hooks/useWebSocket'

export default function Home() {
  const {
    chats, currentChatId, messagesByChatId,
    isProcessing, streamingContent, error,
    loadChats, createChat, deleteChat, renameChat,
    setCurrentChat, sendMessage, clearChat,
  } = useChatStore()

  const currentMessages = currentChatId ? (messagesByChatId[currentChatId] || []) : []
  const { send } = useWebSocket(currentChatId || '')

  const [input, setInput] = useState('')
  const [showMemory, setShowMemory] = useState(false)
  const [memoryContent, setMemoryContent] = useState('')
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadChats()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages, streamingContent])

  useEffect(() => {
    if (editingChatId) editInputRef.current?.focus()
  }, [editingChatId])

  const handleSend = (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isProcessing || !currentChatId) return
    sendMessage(input.trim())
    send(input.trim())
    setInput('')
  }

  const handleNewChat = async () => {
    await createChat()
  }

  const handleSelectChat = (id: string) => {
    if (id === currentChatId) return
    setCurrentChat(id)
  }

  const handleRename = async (id: string) => {
    if (editName.trim()) {
      await renameChat(id, editName.trim())
    }
    setEditingChatId(null)
  }

  const startEdit = (e: React.MouseEvent, chat: { id: string; name: string }) => {
    e.stopPropagation()
    setEditingChatId(chat.id)
    setEditName(chat.name)
  }

  const loadMemory = async () => {
    if (!currentChatId) return
    try {
      const res = await fetch(`/api/chats/${currentChatId}/memory`)
      const data = await res.json()
      setMemoryContent(data.content || 'No memory yet for this chat.')
      setShowMemory(true)
    } catch {
      setMemoryContent('Failed to load memory.')
      setShowMemory(true)
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <main className="flex h-screen bg-gray-950 text-gray-100">

      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-0'} transition-all duration-200 overflow-hidden flex-shrink-0 flex flex-col border-r border-gray-800 bg-gray-900`}>
        <div className="p-3 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center text-xs font-bold flex-shrink-0">A</div>
          <span className="font-semibold text-sm flex-1">Atlas</span>
          <button
            onClick={handleNewChat}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition text-lg leading-none"
            title="New chat"
          >
            +
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2 space-y-0.5">
          {chats.length === 0 && (
            <p className="text-xs text-gray-600 text-center mt-8">No chats yet</p>
          )}
          {chats.map(chat => (
            <div
              key={chat.id}
              onClick={() => handleSelectChat(chat.id)}
              className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition ${
                chat.id === currentChatId
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
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
                    <button
                      onClick={e => startEdit(e, chat)}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-600 text-gray-400 hover:text-white text-xs"
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); deleteChat(chat.id) }}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-800 text-gray-400 hover:text-red-300 text-xs"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-800 text-gray-500 hover:text-white transition text-sm"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-gray-300 truncate max-w-xs">
              {currentChatId ? (chats.find(c => c.id === currentChatId)?.name || 'Chat') : 'Select a chat'}
            </span>
          </div>
          <div className="flex gap-2">
            {currentChatId && (
              <>
                <button
                  onClick={loadMemory}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg transition"
                >
                  Memory
                </button>
                <button
                  onClick={clearChat}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg transition"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4 space-y-4">
          {!currentChatId ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-600">
              <p className="text-sm">Create a new chat to get started</p>
              <button
                onClick={handleNewChat}
                className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-xl hover:bg-emerald-500 transition"
              >
                New Chat
              </button>
            </div>
          ) : currentMessages.length === 0 && !streamingContent ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              Send a message to start...
            </div>
          ) : (
            <>
              {currentMessages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-emerald-600 text-white'
                      : msg.role === 'system'
                      ? 'bg-gray-800 text-gray-400 text-sm italic'
                      : 'bg-gray-800 text-gray-100'
                  }`}>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ))}
              {streamingContent && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-gray-800 text-gray-100">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {streamingContent}<span className="animate-pulse">▌</span>
                    </p>
                  </div>
                </div>
              )}
              {isProcessing && !streamingContent && (
                <div className="flex justify-start">
                  <div className="bg-gray-800 rounded-2xl px-4 py-3">
                    <div className="flex gap-1.5">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="w-2 h-2 bg-gray-500 rounded-full" style={{
                          animation: `pulse-dot 1.4s ease-in-out ${i * 0.2}s infinite`
                        }} />
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
            >
              Send
            </button>
          </div>
        </form>
      </div>

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
