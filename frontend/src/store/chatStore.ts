import { create } from 'zustand'
import type { ChatStore, Message, Chat } from '@/types'

const genId = () => Math.random().toString(36).slice(2, 12)

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: [],
  currentChatId: null,
  messagesByChatId: {},
  isProcessing: false,
  streamingContent: '',
  error: null,

  // ── Chat Management ────────────────────────────────────────────

  loadChats: async () => {
    try {
      const res = await fetch('/api/chats')
      const data = await res.json()
      const chats: Chat[] = data.chats || []
      set({ chats })
      // Auto-select first chat if none selected
      if (chats.length > 0 && !get().currentChatId) {
        get().setCurrentChat(chats[0].id)
      }
    } catch (e) {
      console.error('Failed to load chats', e)
    }
  },

  createChat: async (name?: string) => {
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || '' }),
      })
      const chat: Chat = await res.json()
      set(s => ({ chats: [chat, ...s.chats] }))
      get().setCurrentChat(chat.id)
    } catch (e) {
      console.error('Failed to create chat', e)
    }
  },

  deleteChat: async (id: string) => {
    try {
      await fetch(`/api/chats/${id}`, { method: 'DELETE' })
      const { chats, currentChatId, messagesByChatId } = get()
      const remaining = chats.filter(c => c.id !== id)
      const { [id]: _, ...rest } = messagesByChatId
      set({ chats: remaining, messagesByChatId: rest })
      if (currentChatId === id) {
        if (remaining.length > 0) {
          get().setCurrentChat(remaining[0].id)
        } else {
          set({ currentChatId: null })
        }
      }
    } catch (e) {
      console.error('Failed to delete chat', e)
    }
  },

  renameChat: async (id: string, name: string) => {
    try {
      await fetch(`/api/chats/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      set(s => ({
        chats: s.chats.map(c => c.id === id ? { ...c, name } : c)
      }))
    } catch (e) {
      console.error('Failed to rename chat', e)
    }
  },

  setCurrentChat: (id: string) => {
    set({
      currentChatId: id,
      streamingContent: '',
      isProcessing: false,
      error: null,
    })
    // Load history if not already loaded
    if (!get().messagesByChatId[id]) {
      get().loadHistory(id)
    }
  },

  loadHistory: async (chatId: string) => {
    try {
      const res = await fetch(`/api/history/${chatId}?limit=100`)
      const data = await res.json()
      const messages: Message[] = (data.history || []).map((h: any) => ({
        id: genId(),
        role: h.role,
        content: h.content,
        timestamp: new Date(h.timestamp).getTime(),
      }))
      set(s => ({
        messagesByChatId: { ...s.messagesByChatId, [chatId]: messages }
      }))
    } catch (e) {
      console.error('Failed to load history', e)
    }
  },

  // ── Messaging ─────────────────────────────────────────────────

  sendMessage: (content: string) => {
    const { currentChatId, messagesByChatId } = get()
    if (!currentChatId) return
    const msg: Message = { id: genId(), role: 'user', content, timestamp: Date.now() }
    const existing = messagesByChatId[currentChatId] || []
    set(s => ({
      messagesByChatId: { ...s.messagesByChatId, [currentChatId]: [...existing, msg] },
      isProcessing: true,
      streamingContent: '',
      error: null,
    }))
  },

  addMessage: (msg: Message) => {
    const { currentChatId, messagesByChatId } = get()
    if (!currentChatId) return
    const existing = messagesByChatId[currentChatId] || []
    set(s => ({
      messagesByChatId: { ...s.messagesByChatId, [currentChatId]: [...existing, msg] }
    }))
  },

  appendStreaming: (token: string) => {
    set(s => ({ streamingContent: s.streamingContent + token }))
  },

  finalizeStreaming: () => {
    const { streamingContent, currentChatId, messagesByChatId } = get()
    if (streamingContent && currentChatId) {
      const msg: Message = { id: genId(), role: 'assistant', content: streamingContent, timestamp: Date.now() }
      const existing = messagesByChatId[currentChatId] || []
      set(s => ({
        messagesByChatId: { ...s.messagesByChatId, [currentChatId]: [...existing, msg] },
        streamingContent: '',
        isProcessing: false,
      }))
      // Refresh chat list so AI-generated name appears in sidebar
      setTimeout(() => get().loadChats(), 1500)
    } else {
      set({ isProcessing: false, streamingContent: '' })
    }
  },

  setProcessing: (v) => set({ isProcessing: v }),
  setError: (e) => set({ error: e, isProcessing: false }),

  clearChat: () => {
    const { currentChatId } = get()
    if (!currentChatId) return
    set(s => ({
      messagesByChatId: { ...s.messagesByChatId, [currentChatId]: [] },
      streamingContent: '',
      error: null,
      isProcessing: false,
    }))
    fetch(`/api/history/${currentChatId}`, { method: 'DELETE' })
  },
}))