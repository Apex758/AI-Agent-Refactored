import { create } from 'zustand'
import type { ChatStore, Message, ToolResult } from '@/types'

const generateId = () => Math.random().toString(36).substring(2, 15)

export const useChatStore = create<ChatStore>((set, get) => ({
  // State
  messages: [],
  isProcessing: false,
  currentStreamingMessage: '',
  results: [],
  error: null,

  // Actions
  sendMessage: (content: string) => {
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    set((state) => ({
      messages: [...state.messages, userMessage],
      isProcessing: true,
      currentStreamingMessage: '',
      error: null,
    }))
  },

  addMessage: (message: Message) => {
    set((state) => ({
      messages: [...state.messages, message],
    }))
  },

  updateStreamingContent: (content: string) => {
    set({ currentStreamingMessage: content })
  },

  setProcessing: (processing: boolean) => {
    set({ isProcessing: processing })
    
    // When processing finishes, add the streaming message as a new assistant message
    if (!processing) {
      const { currentStreamingMessage, messages } = get()
      if (currentStreamingMessage) {
        const assistantMessage: Message = {
          id: generateId(),
          role: 'assistant',
          content: currentStreamingMessage,
          timestamp: Date.now(),
        }
        set({
          messages: [...messages, assistantMessage],
          currentStreamingMessage: '',
        })
      }
    }
  },

  addToolResult: (result: ToolResult) => {
    set((state) => ({
      results: [...state.results, result],
    }))
  },

  setError: (error: string | null) => {
    set({ error, isProcessing: false })
  },

  clearChat: () => {
    set({
      messages: [],
      isProcessing: false,
      currentStreamingMessage: '',
      results: [],
      error: null,
    })
  },
}))
