export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: number
}

export interface Chat {
  id: string
  name: string
  created_at: string
}

export interface MemoryResult {
  id: string
  text: string
  score: number
  source: string
}

export interface WSMessage {
  type: 'token' | 'complete' | 'status' | 'system' | 'error'
  content: string
}

export interface ChatStore {
  // Chats list
  chats: Chat[]
  currentChatId: string | null
  loadChats: () => Promise<void>
  createChat: (name?: string) => Promise<void>
  deleteChat: (id: string) => Promise<void>
  renameChat: (id: string, name: string) => Promise<void>
  setCurrentChat: (id: string) => void

  // Messages (keyed by chatId)
  messagesByChatId: Record<string, Message[]>
  loadHistory: (chatId: string) => Promise<void>

  // Current session state
  isProcessing: boolean
  streamingContent: string
  error: string | null

  sendMessage: (content: string) => void
  addMessage: (msg: Message) => void
  appendStreaming: (token: string) => void
  finalizeStreaming: () => void
  setProcessing: (v: boolean) => void
  setError: (e: string | null) => void
  clearChat: () => void
}
