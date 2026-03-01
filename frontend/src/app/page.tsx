'use client'

import { useState, useRef, useEffect, FormEvent } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useWebSocket } from '@/hooks/useWebSocket'

export default function Home() {
  const { messages, isProcessing, streamingContent, error, sendMessage, clearChat } = useChatStore()
  const { send } = useWebSocket()
  const [input, setInput] = useState('')
  const [showMemory, setShowMemory] = useState(false)
  const [memoryContent, setMemoryContent] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const handleSend = (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isProcessing) return
    sendMessage(input.trim())
    send(input.trim())
    setInput('')
  }

  const loadMemory = async () => {
    try {
      const res = await fetch('/api/memory')
      const data = await res.json()
      setMemoryContent(data.content || 'No memories yet.')
      setShowMemory(true)
    } catch { setMemoryContent('Failed to load memory.') }
  }

  return (
    <main className="flex flex-col h-screen max-w-4xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-sm font-bold">A</div>
          <h1 className="text-lg font-semibold">Atlas</h1>
          <span className="text-xs text-gray-500">AI Agent</span>
        </div>
        <div className="flex gap-2">
          <button onClick={loadMemory} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg transition">
            Memory
          </button>
          <button onClick={clearChat} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg transition">
            Clear
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-600">
            <p>Send a message to start...</p>
          </div>
        )}
        {messages.map((msg) => (
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
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{streamingContent}<span className="animate-pulse">▌</span></p>
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
        {error && (
          <div className="flex justify-center">
            <div className="bg-red-900/30 text-red-400 text-sm rounded-lg px-4 py-2">{error}</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="px-6 py-4 border-t border-gray-800">
        <div className="flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message Atlas..."
            disabled={isProcessing}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-50 placeholder-gray-500"
          />
          <button
            type="submit"
            disabled={isProcessing || !input.trim()}
            className="px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 transition text-sm font-medium"
          >
            Send
          </button>
        </div>
      </form>

      {/* Memory Modal */}
      {showMemory && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowMemory(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto m-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Agent Memory</h2>
              <button onClick={() => setShowMemory(false)} className="text-gray-500 hover:text-white">✕</button>
            </div>
            <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">{memoryContent}</pre>
          </div>
        </div>
      )}
    </main>
  )
}
