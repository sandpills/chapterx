/**
 * Activation Log Types
 * 
 * An activation represents a single bot response cycle, which may include
 * multiple completions (in tool loops) and phantom completions (all thinking).
 */

export type TriggerType = 'message' | 'mention' | 'reply' | 'timer' | 'api' | 'random'

export interface ActivationTrigger {
  type: TriggerType
  // The anchor point - completions are inserted after this message in context
  anchorMessageId: string
}

export interface ToolCall {
  id: string
  name: string
  input: any
}

export interface ToolResult {
  callId: string
  output: any
  error?: string
}

export interface Completion {
  // Position in activation (0, 1, 2...)
  index: number
  
  // Full completion text (with thinking, tool calls, etc.)
  text: string
  
  // Discord message IDs sent for this completion (empty for phantoms)
  sentMessageIds: string[]
  
  // Tool calls made in this completion (if any)
  toolCalls: ToolCall[]
  
  // Tool results received (if any)
  toolResults: ToolResult[]
}

export interface Activation {
  id: string
  channelId: string
  botId: string
  
  // What triggered this activation and where to anchor it
  trigger: ActivationTrigger
  
  // Ordered sequence of completions
  completions: Completion[]
  
  // Per-message context chunks: messageId → LLM-visible context for that message
  // Used for progressive display with inline tool execution
  messageContexts: Record<string, string>
  
  // When this activation started
  startedAt: Date
  
  // When this activation ended (all completions done)
  endedAt?: Date
}

/**
 * Stored format for persistence (JSON-serializable)
 */
export interface StoredActivation {
  id: string
  channelId: string
  botId: string
  trigger: ActivationTrigger
  completions: Completion[]
  messageContexts: Record<string, string>
  startedAt: string  // ISO date string
  endedAt?: string
}

/**
 * Index entry for quick lookups
 */
export interface ActivationIndexEntry {
  id: string
  channelId: string
  botId: string
  triggerType: TriggerType
  anchorMessageId: string
  // All message IDs sent during this activation (for quick "is this message from an activation" lookups)
  sentMessageIds: string[]
  startedAt: string
}

