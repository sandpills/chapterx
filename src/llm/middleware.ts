/**
 * LLM Middleware
 * Transforms participant-based format to provider-specific formats
 */

import {
  LLMRequest,
  LLMCompletion,
  ParticipantMessage,
  ContentBlock,
  TextContent,
  LLMError,
  VendorConfig,
} from '../types.js'
import { logger } from '../utils/logger.js'
import { retryLLM } from '../utils/retry.js'
import { matchesAny } from '../utils/validation.js'

export interface LLMProvider {
  readonly name: string
  readonly supportedModes: ('prefill' | 'chat')[]
  complete(request: ProviderRequest): Promise<LLMCompletion>
}

export interface ProviderRequest {
  messages: ProviderMessage[]
  model: string
  temperature: number
  maxTokens: number
  topP: number
  stopSequences?: string[]
  tools?: any[]
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | any[]
}

export class LLMMiddleware {
  private providers = new Map<string, LLMProvider>()
  private vendorConfigs: Record<string, VendorConfig> = {}

  constructor() {}

  /**
   * Register a provider
   */
  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.name, provider)
    logger.info({ provider: provider.name }, 'Registered LLM provider')
  }

  /**
   * Set vendor configurations
   */
  setVendorConfigs(configs: Record<string, VendorConfig>): void {
    this.vendorConfigs = configs
  }

  /**
   * Complete a request with automatic provider selection
   */
  async complete(request: LLMRequest): Promise<LLMCompletion> {
    const provider = this.selectProvider(request.config.model)

    // Check if mode is supported
    if (!provider.supportedModes.includes(request.config.mode)) {
      throw new LLMError(
        `Provider ${provider.name} does not support ${request.config.mode} mode`
      )
    }

    // Transform to provider format based on mode
    const providerRequest =
      request.config.mode === 'prefill'
        ? this.transformToPrefill(request, provider)
        : this.transformToChat(request, provider)

    // Execute with retries
    const completion = await retryLLM(
      () => provider.complete(providerRequest),
      3  // TODO: Get from config
    )

    return completion
  }

  private selectProvider(modelName: string): LLMProvider {
    // Check vendor configs for model match
    for (const [vendorName, config] of Object.entries(this.vendorConfigs)) {
      if (matchesAny(modelName, config.provides)) {
        const provider = this.providers.get(vendorName)
        if (provider) {
          return provider
        }
      }
    }

    throw new LLMError(`No provider found for model: ${modelName}`)
  }

  private transformToPrefill(request: LLMRequest, _provider: LLMProvider): ProviderRequest {
    // Build conversation, splitting messages with images into user turns
    const messages: ProviderMessage[] = []
    const botName = request.config.botInnerName
    let lastNonEmptyParticipant: string | null = null
    let currentConversation: string[] = []
    let toolsInserted = false
    
    // Add system prompt if present
    if (request.systemPrompt) {
      messages.push({
        role: 'system',
        content: request.systemPrompt,
      })
    }
    
    for (let i = 0; i < request.messages.length; i++) {
      const msg = request.messages[i]!
      const isLastMessage = i === request.messages.length - 1
      const formatted = this.formatContentForPrefill(msg.content, msg.participant)
      const hasImages = formatted.images.length > 0
      const isEmpty = !formatted.text.trim() && !hasImages
      
      // Check if we need to insert tools at depth 2-3
      if (!toolsInserted && request.tools && request.tools.length > 0 && currentConversation.length >= 3) {
        // Flush current conversation
        if (currentConversation.length > 0) {
          messages.push({
            role: 'assistant',
            content: currentConversation.join('\n\n'),
          })
          currentConversation = []
        }
        
        // Add tools
        messages.push({
          role: 'user',
          content: this.formatToolsForPrefill(request.tools),
        })
        toolsInserted = true
      }
      
      // If message has images, flush current conversation and add as user message
      if (hasImages && !isEmpty) {
        // Flush current assistant conversation
        if (currentConversation.length > 0) {
          messages.push({
            role: 'assistant',
            content: currentConversation.join('\n\n'),
          })
          currentConversation = []
        }
        
        // Add message with image as user turn
        const userContent: any[] = []
        if (formatted.text) {
          userContent.push({type: 'text', text: `${msg.participant}: ${formatted.text}`})
        }
        userContent.push(...formatted.images)
        
        messages.push({
          role: 'user',
          content: userContent,
        })
        
        lastNonEmptyParticipant = msg.participant
        continue
      }
      
      // Skip empty messages (except last)
      if (isEmpty && !isLastMessage) {
        continue
      }
      
      // Check bot continuation logic
      const isBotMessage = msg.participant === botName
      const hasToolResult = msg.content.some(c => c.type === 'tool_result')
      const isContinuation = isBotMessage && lastNonEmptyParticipant === botName && !hasToolResult
      
      if (isContinuation && isLastMessage) {
        // Bot continuation - don't add prefix, just complete from where we are
        continue
      } else if (isLastMessage && isEmpty) {
        // Completion target
        currentConversation.push(`${msg.participant}:`)
      } else if (formatted.text) {
        // Regular message
        currentConversation.push(`${msg.participant}: ${formatted.text}`)
        if (!hasToolResult) {
          lastNonEmptyParticipant = msg.participant
        }
      }
    }
    
    // Flush any remaining conversation
    if (currentConversation.length > 0) {
      messages.push({
        role: 'assistant',
        content: currentConversation.join('\n\n'),
      })
    }

    return {
      messages,
      model: request.config.model,
      temperature: request.config.temperature,
      maxTokens: request.config.maxTokens,
      topP: request.config.topP,
      stopSequences: request.stopSequences,
      tools: undefined,  // Don't use native tool use in prefill mode
    }
  }

  private transformToChat(request: LLMRequest, _provider: LLMProvider): ProviderRequest {
    const messages: ProviderMessage[] = []

    // Add system prompt
    if (request.systemPrompt) {
      messages.push({
        role: 'system',
        content: request.systemPrompt,
      })
    }

    // Group consecutive non-bot messages
    const botName = request.config.botInnerName
    let buffer: ParticipantMessage[] = []

    for (const msg of request.messages) {
      const isBot = msg.participant === botName

      if (isBot) {
        // Flush buffer
        if (buffer.length > 0) {
          messages.push(this.mergeToUserMessage(buffer))
          buffer = []
        }
        // Add bot message
        const text = this.extractText(msg.content)
        messages.push({
          role: 'assistant',
          content: text,
        })
      } else {
        // Add to buffer
        buffer.push(msg)
      }
    }

    // Flush remaining buffer
    if (buffer.length > 0) {
      messages.push(this.mergeToUserMessage(buffer))
    }

    return {
      messages,
      model: request.config.model,
      temperature: request.config.temperature,
      maxTokens: request.config.maxTokens,
      topP: request.config.topP,
      tools: request.tools,
    }
  }

  private mergeToUserMessage(messages: ParticipantMessage[]): ProviderMessage {
    const parts: string[] = []

    for (const msg of messages) {
      const text = this.extractText(msg.content)
      if (text) {
        parts.push(`${msg.participant}: ${text}`)
      }
    }

    return {
      role: 'user',
      content: parts.join('\n\n'),
    }
  }

  private formatContentForPrefill(content: ContentBlock[], participant: string): {text: string, images: any[]} {
    const parts: string[] = []
    const images: any[] = []

    for (const block of content) {
      if (block.type === 'text') {
        parts.push((block as any).text)
      } else if (block.type === 'image') {
        // Images are handled separately - will be added as content blocks in Anthropic format
        images.push(block)
      } else if (block.type === 'tool_use') {
        const toolUse = block as any
        // Format as: Name>[toolname]: {json}
        parts.push(`${participant}>[${toolUse.name}]: ${JSON.stringify(toolUse.input)}`)
      } else if (block.type === 'tool_result') {
        const toolResult = block as any
        const resultText = typeof toolResult.content === 'string' 
          ? toolResult.content 
          : JSON.stringify(toolResult.content)
        // Format as: Name<[toolname]: result
        // Extract tool name from ID or use generic
        parts.push(`${participant}<[tool_result]: ${resultText}`)
      }
    }

    return {text: parts.join('\n\n'), images}
  }

  private extractText(content: ContentBlock[]): string {
    return content
      .filter((c) => c.type === 'text')
      .map((c) => (c as TextContent).text)
      .join('\n')
  }

  private formatToolsForPrefill(tools: any[]): string {
    const formatted = tools.map((tool) => {
      const params = JSON.stringify(tool.inputSchema.properties || {}, null, 2)
      return `- ${tool.name}: ${tool.description}\n  Input schema: ${params}`
    })

    return `<tools>
You have access to the following tools. To use a tool, output it in XML format:
<tool_name>{"param": "value"}</tool_name>

The tool results will be provided by the System participant.

Available tools:
${formatted.join('\n\n')}
</tools>`
  }
}

