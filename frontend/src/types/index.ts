export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: number
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
  messages: Message[]
  isProcessing: boolean
  streamingContent: string
  memoryContent: string
  error: string | null
  sendMessage: (content: string) => void
  addMessage: (msg: Message) => void
  appendStreaming: (token: string) => void
  finalizeStreaming: () => void
  setProcessing: (v: boolean) => void
  setError: (e: string | null) => void
  setMemory: (content: string) => void
  clearChat: () => void
}
