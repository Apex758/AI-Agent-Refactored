export type MessageRole = 'user' | 'assistant' | 'system'

export interface Citation {
  doc_id: string
  filename: string
  page: number
  source_type: 'linked_doc' | 'cross_chat_doc'
}

export interface Attachment {
  type: 'image'
  dataUrl: string
  name: string
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  citations?: Citation[]
  attachment?: Attachment
}

export interface Chat {
  id: string
  name: string
  created_at: string
}

export interface Document {
  doc_id: string
  filename: string
  chat_id: string
  chunk_count: number
  file_size: number
  uploaded_at: string
}

export interface WSMessage {
  type: 'token' | 'complete' | 'status' | 'citations' | 'error'
  content?: string
  citations?: Citation[]
}

export interface VoiceState {
  isRecording: boolean
  isPlaying: boolean
  audioLevel: number
  localStream: MediaStream | null
}

export interface ChatStore {
  agentName: string
  chats: Chat[]
  currentChatId: string | null
  messagesByChatId: Record<string, Message[]>
  documentsByChatId: Record<string, Document[]>
  pendingCitations: Citation[]
  isProcessing: boolean
  streamingContent: string
  error: string | null
  voiceState: VoiceState

  loadConfig: () => Promise<void>
  loadChats: () => Promise<void>
  createChat: (name?: string) => Promise<void>
  deleteChat: (id: string) => Promise<void>
  renameChat: (id: string, name: string) => Promise<void>
  setCurrentChat: (id: string) => void
  loadHistory: (chatId: string) => Promise<void>

  loadDocuments: (chatId: string) => Promise<void>
  uploadDocument: (file: File, chatId: string) => Promise<Document>
  deleteDocument: (docId: string, chatId: string) => Promise<void>

  sendMessage: (content: string) => void
  addMessage: (msg: Message) => void
  setCitations: (citations: Citation[]) => void
  appendStreaming: (token: string) => void
  finalizeStreaming: () => void
  setProcessing: (v: boolean) => void
  setError: (e: string | null) => void
  setVoiceState: (state: Partial<VoiceState>) => void
  clearChat: () => void
}