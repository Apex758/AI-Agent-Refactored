import { create } from 'zustand'
import type { ChatStore, Message } from '@/types'

const genId = () => Math.random().toString(36).slice(2, 12)

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isProcessing: false,
  streamingContent: '',
  memoryContent: '',
  error: null,

  sendMessage: (content: string) => {
    const msg: Message = { id: genId(), role: 'user', content, timestamp: Date.now() }
    set(s => ({ messages: [...s.messages, msg], isProcessing: true, streamingContent: '', error: null }))
  },

  addMessage: (msg: Message) => set(s => ({ messages: [...s.messages, msg] })),

  appendStreaming: (token: string) => set(s => ({ streamingContent: s.streamingContent + token })),

  finalizeStreaming: () => {
    const { streamingContent, messages } = get()
    if (streamingContent) {
      const msg: Message = { id: genId(), role: 'assistant', content: streamingContent, timestamp: Date.now() }
      set({ messages: [...messages, msg], streamingContent: '', isProcessing: false })
    } else {
      set({ isProcessing: false })
    }
  },

  setProcessing: (v) => set({ isProcessing: v }),
  setError: (e) => set({ error: e, isProcessing: false }),
  setMemory: (content) => set({ memoryContent: content }),
  clearChat: () => set({ messages: [], streamingContent: '', error: null, isProcessing: false }),
}))
