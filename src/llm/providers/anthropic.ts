/**
 * Anthropic Provider
 */

import Anthropic from '@anthropic-ai/sdk'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { LLMProvider, ProviderRequest } from '../middleware.js'
import { LLMCompletion, ContentBlock, LLMError } from '../../types.js'
import { logger } from '../../utils/logger.js'

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic'
  readonly supportedModes: ('prefill' | 'chat')[] = ['prefill', 'chat']

  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async complete(request: ProviderRequest): Promise<LLMCompletion> {
    try {
      logger.debug({ model: request.model }, 'Calling Anthropic API')

      // Extract system messages and convert to top-level parameter
      const systemMessages = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n\n')

      const nonSystemMessages = request.messages.filter((m) => m.role !== 'system')

      // Build request params (some models don't support both temperature and top_p)
      const params: any = {
        model: request.model,
        max_tokens: request.maxTokens,
        system: systemMessages || undefined,
        messages: nonSystemMessages,
        stop_sequences: request.stopSequences,
      }

      // Only include temperature (not top_p) to avoid API errors with newer models
      if (request.temperature !== undefined) {
        params.temperature = request.temperature
      }

      // Add tools if provided
      if (request.tools && request.tools.length > 0) {
        params.tools = request.tools
      }

      // Log request to file
      this.logRequestToFile(params)

      const response = await this.client.messages.create(params)

      // Log response to file
      this.logResponseToFile(response)

      logger.debug({ 
        stopReason: response.stop_reason,
        contentBlocks: response.content.length,
        firstBlock: response.content[0]?.type
      }, 'Received Anthropic response')

      // Parse response
      const content: ContentBlock[] = response.content.map((block: any) => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text }
        } else if (block.type === 'tool_use') {
          return {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          }
        }
        // Unknown block type, return as text
        return { type: 'text', text: JSON.stringify(block) }
      })

      return {
        content,
        stopReason: this.mapStopReason(response.stop_reason),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationTokens: (response.usage as any).cache_creation_input_tokens,
          cacheReadTokens: (response.usage as any).cache_read_input_tokens,
        },
        model: response.model,
        raw: response,
      }
    } catch (error) {
      logger.error({ error }, 'Anthropic API error')
      throw new LLMError('Anthropic API call failed', error)
    }
  }

  private mapStopReason(reason: string | null): 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' {
    switch (reason) {
      case 'end_turn':
        return 'end_turn'
      case 'max_tokens':
        return 'max_tokens'
      case 'stop_sequence':
        return 'stop_sequence'
      case 'tool_use':
        return 'tool_use'
      default:
        return 'end_turn'
    }
  }

  private logRequestToFile(params: any): void {
    try {
      const dir = join(process.cwd(), 'logs', 'llm-requests')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = join(dir, `request-${timestamp}.json`)

      writeFileSync(filename, JSON.stringify(params, null, 2))
      logger.debug({ filename }, 'Logged request to file')
    } catch (error) {
      logger.warn({ error }, 'Failed to log request to file')
    }
  }

  private logResponseToFile(response: any): void {
    try {
      const dir = join(process.cwd(), 'logs', 'llm-responses')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = join(dir, `response-${timestamp}.json`)

      writeFileSync(filename, JSON.stringify(response, null, 2))
      logger.debug({ filename }, 'Logged response to file')
    } catch (error) {
      logger.warn({ error }, 'Failed to log response to file')
    }
  }
}

