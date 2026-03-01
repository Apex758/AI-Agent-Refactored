import { create } from 'zustand'
import type { ChatStore, Message, Chat, Document, VoiceState } from '@/types'

const genId = () => Math.random().toString(36).slice(2, 12)

export const useChatStore = create<ChatStore>((set, get) => ({
  agentName: 'Atlas',
  chats: [],
  currentChatId: null,
  messagesByChatId: {},
  documentsByChatId: {},
  pendingCitations: [],
  isProcessing: false,
  streamingContent: '',
  error: null,
  voiceState: {
    isRecording: false,
    isPlaying: false,
    audioLevel: 0,
    localStream: null,
  },

  // ── Config ─────────────────────────────────────────────────────

  loadConfig: async () => {
    try {
      const res = await fetch('/api/config')
      const data = await res.json()
      set({ agentName: data.agent_name })
    } catch {}
  },

  // ── Chat Management ────────────────────────────────────────────

  loadChats: async () => {
    try {
      const res = await fetch('/api/chats')
      const data = await res.json()
      const chats: Chat[] = data.chats || []
      set({ chats })
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
      const { chats, currentChatId, messagesByChatId, documentsByChatId } = get()
      const remaining = chats.filter(c => c.id !== id)
      const { [id]: _m, ...restMessages } = messagesByChatId
      const { [id]: _d, ...restDocs } = documentsByChatId
      set({ chats: remaining, messagesByChatId: restMessages, documentsByChatId: restDocs })
      if (currentChatId === id) {
        remaining.length > 0 ? get().setCurrentChat(remaining[0].id) : set({ currentChatId: null })
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
      set(s => ({ chats: s.chats.map(c => c.id === id ? { ...c, name } : c) }))
    } catch (e) {
      console.error('Failed to rename chat', e)
    }
  },

  setCurrentChat: (id: string) => {
    set({ currentChatId: id, streamingContent: '', isProcessing: false, error: null, pendingCitations: [] })
    if (!get().messagesByChatId[id]) get().loadHistory(id)
    if (!get().documentsByChatId[id]) get().loadDocuments(id)
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
        citations: [],
      }))
      set(s => ({ messagesByChatId: { ...s.messagesByChatId, [chatId]: messages } }))
    } catch (e) {
      console.error('Failed to load history', e)
    }
  },

  // ── Documents ──────────────────────────────────────────────────

  loadDocuments: async (chatId: string) => {
    try {
      const res = await fetch(`/api/documents?chat_id=${chatId}`)
      const data = await res.json()
      set(s => ({
        documentsByChatId: { ...s.documentsByChatId, [chatId]: data.documents || [] }
      }))
    } catch (e) {
      console.error('Failed to load documents', e)
    }
  },

  uploadDocument: async (file: File, chatId: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('chat_id', chatId)
    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Upload failed')
      }
      const doc: Document = await res.json()
      set(s => ({
        documentsByChatId: {
          ...s.documentsByChatId,
          [chatId]: [doc, ...(s.documentsByChatId[chatId] || [])],
        }
      }))
      return doc
    } catch (e: any) {
      throw new Error(e.message || 'Upload failed')
    }
  },

  deleteDocument: async (docId: string, chatId: string) => {
    try {
      await fetch(`/api/documents/${docId}`, { method: 'DELETE' })
      set(s => ({
        documentsByChatId: {
          ...s.documentsByChatId,
          [chatId]: (s.documentsByChatId[chatId] || []).filter(d => d.doc_id !== docId),
        }
      }))
    } catch (e) {
      console.error('Failed to delete document', e)
    }
  },

  // ── Messaging ─────────────────────────────────────────────────

  sendMessage: (content: string) => {
    const { currentChatId, messagesByChatId } = get()
    if (!currentChatId) return
    const msg: Message = { id: genId(), role: 'user', content, timestamp: Date.now(), citations: [] }
    set(s => ({
      messagesByChatId: { ...s.messagesByChatId, [currentChatId]: [...(messagesByChatId[currentChatId] || []), msg] },
      isProcessing: true,
      streamingContent: '',
      error: null,
      pendingCitations: [],
    }))
  },

  addMessage: (msg: Message) => {
    const { currentChatId, messagesByChatId } = get()
    if (!currentChatId) return
    set(s => ({
      messagesByChatId: { ...s.messagesByChatId, [currentChatId]: [...(messagesByChatId[currentChatId] || []), msg] }
    }))
  },

  addScrapedMedia: (images: string[], videos: string[]) => {
    const { currentChatId, messagesByChatId } = get()
    if (!currentChatId) return
    if (images.length === 0 && videos.length === 0) return
    const msg: Message = {
      id: genId(),
      role: 'system',
      content: '🌐 Scraped media from page',
      timestamp: Date.now(),
      citations: [],
      media: { images, videos },
    }
    set(s => ({
      messagesByChatId: {
        ...s.messagesByChatId,
        [currentChatId]: [...(messagesByChatId[currentChatId] || []), msg],
      },
    }))
  },

  setCitations: (citations) => set({ pendingCitations: citations }),

  appendStreaming: (token: string) => set(s => ({ streamingContent: s.streamingContent + token })),

  finalizeStreaming: () => {
    const { streamingContent, currentChatId, messagesByChatId, pendingCitations } = get()
    if (streamingContent && currentChatId) {
      const msg: Message = {
        id: genId(),
        role: 'assistant',
        content: streamingContent,
        timestamp: Date.now(),
        citations: pendingCitations,
      }
      const existing = messagesByChatId[currentChatId] || []
      set(s => ({
        messagesByChatId: { ...s.messagesByChatId, [currentChatId]: [...existing, msg] },
        streamingContent: '',
        isProcessing: false,
        pendingCitations: [],
      }))
      setTimeout(() => get().loadChats(), 1500)
    } else {
      set({ isProcessing: false, streamingContent: '' })
    }
  },

  setProcessing: (v) => set({ isProcessing: v }),
  setError: (e) => set({ error: e, isProcessing: false }),
  setVoiceState: (partial) => set(s => ({ voiceState: { ...s.voiceState, ...partial } })),

  clearChat: () => {
    const { currentChatId } = get()
    if (!currentChatId) return
    set(s => ({
      messagesByChatId: { ...s.messagesByChatId, [currentChatId]: [] },
      streamingContent: '', error: null, isProcessing: false,
    }))
    fetch(`/api/history/${currentChatId}`, { method: 'DELETE' })
  },
}))