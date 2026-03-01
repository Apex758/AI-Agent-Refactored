// Message types
export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  result: unknown
  error?: string
}

// WebSocket message types
export interface WSMessage {
  type: 'message' | 'tool_call' | 'tool_result' | 'error' | 'connected'
  payload: unknown
}

export interface ChatMessagePayload {
  message: Message
}

export interface ToolCallPayload {
  toolCall: ToolCall
}

export interface ToolResultPayload {
  toolCallId: string
  result: unknown
  error?: string
}

export interface ErrorPayload {
  message: string
}

// Chat state
export interface ChatState {
  messages: Message[]
  isProcessing: boolean
  currentStreamingMessage: string
  results: ToolResult[]
  error: string | null
}

// Actions
export interface ChatActions {
  sendMessage: (content: string) => void
  addMessage: (message: Message) => void
  updateStreamingContent: (content: string) => void
  setProcessing: (processing: boolean) => void
  addToolResult: (result: ToolResult) => void
  setError: (error: string | null) => void
  clearChat: () => void
}

// Store type
export interface ChatStore extends ChatState, ChatActions {}

// WebSocket hook return type
export interface UseWebSocketReturn {
  isConnected: boolean
  send: (data: unknown) => void
  lastMessage: WSMessage | null
}
