/**
 * Activation Store
 * 
 * Persists activation logs to disk, organized by bot/channel.
 * Similar structure to tool cache but for complete activation records.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { logger } from '../utils/logger.js'
import { 
  Activation, 
  StoredActivation, 
  Completion, 
  ToolCall,
  ToolResult 
} from './types.js'

export class ActivationStore {
  private activationDir: string
  
  // In-memory cache of active (incomplete) activations
  private activeActivations = new Map<string, Activation>()
  
  constructor(cacheDir: string) {
    this.activationDir = join(cacheDir, 'activations')
    if (!existsSync(this.activationDir)) {
      mkdirSync(this.activationDir, { recursive: true })
    }
  }
  
  /**
   * Start a new activation
   */
  startActivation(
    botId: string,
    channelId: string,
    trigger: Activation['trigger']
  ): Activation {
    const activation: Activation = {
      id: this.generateActivationId(),
      channelId,
      botId,
      trigger,
      completions: [],
      messageContexts: {},
      startedAt: new Date(),
    }
    
    // Store in active map
    this.activeActivations.set(activation.id, activation)
    
    logger.debug({ 
      activationId: activation.id, 
      botId, 
      channelId,
      triggerType: trigger.type,
      anchorMessageId: trigger.anchorMessageId
    }, 'Started activation')
    
    return activation
  }
  
  /**
   * Add a completion to an active activation
   */
  addCompletion(
    activationId: string,
    text: string,
    sentMessageIds: string[],
    toolCalls: ToolCall[] = [],
    toolResults: ToolResult[] = []
  ): Completion {
    const activation = this.activeActivations.get(activationId)
    if (!activation) {
      throw new Error(`Activation ${activationId} not found or already completed`)
    }
    
    const completion: Completion = {
      index: activation.completions.length,
      text,
      sentMessageIds,
      toolCalls,
      toolResults,
    }
    
    activation.completions.push(completion)
    
    logger.debug({
      activationId,
      completionIndex: completion.index,
      isPhantom: sentMessageIds.length === 0,
      hasTools: toolCalls.length > 0,
      textLength: text.length,
    }, 'Added completion to activation')
    
    return completion
  }
  
  /**
   * Update sent message IDs for the last completion
   * (called after messages are actually sent to Discord)
   */
  updateLastCompletionMessageIds(activationId: string, messageIds: string[]): void {
    const activation = this.activeActivations.get(activationId)
    if (!activation || activation.completions.length === 0) {
      return
    }
    
    const lastCompletion = activation.completions[activation.completions.length - 1]!
    lastCompletion.sentMessageIds = messageIds
    
    logger.debug({
      activationId,
      completionIndex: lastCompletion.index,
      messageIds,
    }, 'Updated completion message IDs')
  }
  
  /**
   * Set the LLM-visible context chunk for a specific message
   * Used for progressive display with inline tool execution
   */
  setMessageContext(activationId: string, messageId: string, contextChunk: string): void {
    const activation = this.activeActivations.get(activationId)
    if (!activation) {
      logger.warn({ activationId, messageId }, 'Tried to set message context for unknown activation')
      return
    }
    
    activation.messageContexts[messageId] = contextChunk
    
    logger.debug({
      activationId,
      messageId,
      contextLength: contextChunk.length,
      hasToolXml: contextChunk.includes('function_calls'),
    }, 'Set message context chunk')
  }
  
  
  /**
   * Complete and persist an activation
   */
  async completeActivation(activationId: string): Promise<void> {
    const activation = this.activeActivations.get(activationId)
    if (!activation) {
      logger.warn({ activationId }, 'Tried to complete unknown activation')
      return
    }
    
    activation.endedAt = new Date()
    
    // Persist to disk
    await this.persistActivation(activation)
    
    // Remove from active map
    this.activeActivations.delete(activationId)
    
    logger.debug({
      activationId,
      completionCount: activation.completions.length,
      phantomCount: activation.completions.filter(c => c.sentMessageIds.length === 0).length,
    }, 'Completed and persisted activation')
  }
  
  /**
   * Get an active activation by ID
   */
  getActiveActivation(activationId: string): Activation | undefined {
    return this.activeActivations.get(activationId)
  }
  
  /**
   * Load activations for a channel that have surviving messages
   */
  async loadActivationsForChannel(
    botId: string,
    channelId: string,
    existingMessageIds: Set<string>
  ): Promise<Activation[]> {
    const dirPath = join(this.activationDir, botId, channelId)
    
    if (!existsSync(dirPath)) {
      return []
    }
    
    const files = readdirSync(dirPath).filter(f => f.endsWith('.json')).sort()
    const activations: Activation[] = []
    let filteredCount = 0
    
    for (const file of files) {
      const filePath = join(dirPath, file)
      try {
        const content = readFileSync(filePath, 'utf-8')
        const stored: StoredActivation = JSON.parse(content)
        
        // Check if this activation is anchored (any sent message still exists)
        const allSentIds = stored.completions.flatMap(c => c.sentMessageIds)
        const hasAnchor = allSentIds.some(id => existingMessageIds.has(id))
        
        if (!hasAnchor && allSentIds.length > 0) {
          // This activation's messages were all deleted - skip it
          filteredCount++
          continue
        }
        
        // Note: We no longer skip activations just because the anchor message is deleted.
        // If bot messages still exist, we want to inject thinking into them.
        // The anchor is only used for phantom placement, which will fall back gracefully.
        
        activations.push({
          ...stored,
          messageContexts: stored.messageContexts || {},  // Handle older activations without messageContexts
          startedAt: new Date(stored.startedAt),
          endedAt: stored.endedAt ? new Date(stored.endedAt) : undefined,
        })
      } catch (error) {
        logger.warn({ error, file: filePath }, 'Failed to load activation file')
      }
    }
    
    logger.debug({
      botId,
      channelId,
      loaded: activations.length,
      filtered: filteredCount,
    }, 'Loaded activations for channel')
    
    return activations
  }
  
  /**
   * Build a map of messageId -> completion for context building
   */
  buildCompletionMap(activations: Activation[]): Map<string, { activation: Activation; completion: Completion }> {
    const map = new Map<string, { activation: Activation; completion: Completion }>()
    
    for (const activation of activations) {
      for (const completion of activation.completions) {
        for (const messageId of completion.sentMessageIds) {
          map.set(messageId, { activation, completion })
        }
      }
    }
    
    return map
  }
  
  /**
   * Build a unified map of messageId -> context chunk from all activations
   * Each message gets its own LLM-visible context for reconstruction
   */
  buildMessageContextMap(activations: Activation[]): Map<string, string> {
    const map = new Map<string, string>()
    
    for (const activation of activations) {
      for (const [messageId, contextChunk] of Object.entries(activation.messageContexts)) {
        map.set(messageId, contextChunk)
      }
    }
    
    return map
  }
  
  /**
   * Get phantom completions that need to be inserted
   * Returns: Map of anchorMessageId -> completions to insert after it
   */
  getPhantomInsertions(
    activations: Activation[],
    existingMessageIds: Set<string>
  ): Map<string, Completion[]> {
    const insertions = new Map<string, Completion[]>()
    
    for (const activation of activations) {
      let currentAnchor = activation.trigger.anchorMessageId
      
      for (const completion of activation.completions) {
        if (completion.sentMessageIds.length === 0) {
          // This is a phantom - insert after current anchor
          const existing = insertions.get(currentAnchor) || []
          existing.push(completion)
          insertions.set(currentAnchor, existing)
        } else {
          // Find the last sent message that still exists as the new anchor
          for (const msgId of completion.sentMessageIds) {
            if (existingMessageIds.has(msgId)) {
              currentAnchor = msgId
            }
          }
        }
      }
    }
    
    return insertions
  }
  
  /**
   * Remove activations associated with a deleted message
   */
  async removeActivationsForMessage(botId: string, channelId: string, messageId: string): Promise<void> {
    const dirPath = join(this.activationDir, botId, channelId)
    
    if (!existsSync(dirPath)) {
      return
    }
    
    const fs = await import('fs/promises')
    const files = readdirSync(dirPath).filter(f => f.endsWith('.json'))
    
    for (const file of files) {
      const filePath = join(dirPath, file)
      try {
        const content = readFileSync(filePath, 'utf-8')
        const stored: StoredActivation = JSON.parse(content)
        
        // Check if any completion sent this message
        const hasMsgId = stored.completions.some(c => 
          c.sentMessageIds.includes(messageId)
        )
        
        if (hasMsgId) {
          // Remove the message ID from completions
          let modified = false
          for (const completion of stored.completions) {
            const idx = completion.sentMessageIds.indexOf(messageId)
            if (idx !== -1) {
              completion.sentMessageIds.splice(idx, 1)
              modified = true
            }
          }
          
          // Check if activation is now orphaned (no messages left)
          const allSentIds = stored.completions.flatMap(c => c.sentMessageIds)
          if (allSentIds.length === 0) {
            // Delete the file
            await fs.unlink(filePath)
            logger.debug({ filePath, messageId }, 'Deleted orphaned activation file')
          } else if (modified) {
            // Update the file
            writeFileSync(filePath, JSON.stringify(stored, null, 2))
            logger.debug({ filePath, messageId }, 'Updated activation file after message deletion')
          }
        }
      } catch (error) {
        logger.warn({ error, file: filePath }, 'Failed to process activation file during deletion')
      }
    }
  }
  
  // --- Private helpers ---
  
  private generateActivationId(): string {
    return Math.random().toString(36).substring(2, 10)
  }
  
  private async persistActivation(activation: Activation): Promise<void> {
    const dirPath = join(this.activationDir, activation.botId, activation.channelId)
    
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }
    
    // Use date-based filename for sorting
    const dateStr = activation.startedAt.toISOString().replace(/[:.]/g, '-')
    const fileName = `${dateStr}-${activation.id}.json`
    const filePath = join(dirPath, fileName)
    
    const stored: StoredActivation = {
      ...activation,
      startedAt: activation.startedAt.toISOString(),
      endedAt: activation.endedAt?.toISOString(),
    }
    
    writeFileSync(filePath, JSON.stringify(stored, null, 2))
    
    logger.debug({ filePath, activationId: activation.id }, 'Persisted activation')
  }
}

