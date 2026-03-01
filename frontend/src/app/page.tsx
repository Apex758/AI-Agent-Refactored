'use client'

import { ChatWindow } from '@/components/chat/ChatWindow'
import { InputBox } from '@/components/chat/InputBox'
import { ResultsPanel } from '@/components/results/ResultsPanel'
import { useChatStore } from '@/store/chatStore'

export default function Home() {
  const { messages, isProcessing, sendMessage, clearChat } = useChatStore()

  return (
    <main className="flex flex-col h-screen max-w-5xl mx-auto p-4">
      <header className="flex items-center justify-between py-4 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-gray-800">AI Agent</h1>
        <button
          onClick={clearChat}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
        >
          Clear Chat
        </button>
      </header>

      <div className="flex-1 flex gap-4 mt-4 overflow-hidden">
        <div className="flex-1 flex flex-col">
          <ChatWindow messages={messages} isProcessing={isProcessing} />
          <InputBox onSend={sendMessage} disabled={isProcessing} />
        </div>
        
        <ResultsPanel />
      </div>
    </main>
  )
}
