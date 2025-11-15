/**
 * Tool System
 * Wraps MCP client and handles JSONL persistence
 */

import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ToolDefinition, ToolCall, ToolResult, ToolError, MCPServerConfig } from '../types.js'
import { logger } from '../utils/logger.js'

export class ToolSystem {
  private mcpClients = new Map<string, Client>()
  private tools: ToolDefinition[] = []

  constructor(private toolCacheDir: string) {}

  /**
   * Initialize MCP clients from configuration
   */
  async initializeServers(serverConfigs: MCPServerConfig[]): Promise<void> {
    if (!serverConfigs || serverConfigs.length === 0) {
      logger.info('No MCP servers configured, tools disabled')
      return
    }

    logger.info({ serverCount: serverConfigs.length }, 'Initializing MCP servers')

    for (const config of serverConfigs) {
      try {
        await this.initializeServer(config)
      } catch (error) {
        logger.error({ error, server: config.name }, 'Failed to initialize MCP server')
        // Continue with other servers
      }
    }

    logger.info({ 
      serverCount: this.mcpClients.size, 
      toolCount: this.tools.length 
    }, 'MCP initialization complete')
  }

  private async initializeServer(config: MCPServerConfig): Promise<void> {
    logger.info({ 
      server: config.name, 
      command: config.command, 
      args: config.args 
    }, 'Initializing MCP server')

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: config.env,
    })

    const client = new Client({
      name: 'chapter3',
      version: '0.1.0',
    }, {
      capabilities: {}
    })

    await client.connect(transport)

    // Load tools from this server
    const response = await client.listTools()
    const serverTools: ToolDefinition[] = response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema as any,
      serverName: config.name,
    }))

    this.mcpClients.set(config.name, client)
    this.tools.push(...serverTools)

    logger.info({ 
      server: config.name, 
      toolCount: serverTools.length 
    }, 'MCP server initialized')
  }


  /**
   * Get available tools
   */
  getAvailableTools(): ToolDefinition[] {
    return this.tools
  }

  /**
   * Load tool cache from JSONL files (with results)
   */
  async loadCacheWithResults(botId: string, channelId: string): Promise<Array<{call: ToolCall, result: any}>> {
    const dirPath = join(this.toolCacheDir, botId, channelId)

    if (!existsSync(dirPath)) {
      return []
    }

    // Read all JSONL files in the directory
    const fs = await import('fs/promises')
    const files = await fs.readdir(dirPath)
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl')).sort()

    const allEntries: Array<{call: ToolCall, result: any}> = []

    for (const file of jsonlFiles) {
      const filePath = join(dirPath, file)
      try {
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.trim().split('\n').filter((l) => l.trim())

        for (const line of lines) {
          const entry = JSON.parse(line)
          
          // Truncate large results to prevent context bloat
          let result = entry.result.output
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
          if (resultStr.length > 2000) {
            result = resultStr.substring(0, 2000) + '\n...[truncated]'
          }
          
          allEntries.push({
            call: {
              id: entry.call.id,
              name: entry.call.name,
              input: entry.call.input,
              messageId: entry.call.messageId,
              timestamp: new Date(entry.timestamp),
              originalCompletionText: entry.call.originalCompletionText || '',
            },
            result
          })
        }
      } catch (error) {
        logger.warn({ error, file: filePath }, 'Failed to load tool cache file')
      }
    }

    // Limit to last 5 tool calls to prevent context bloat
    const limitedEntries = allEntries.slice(-5)

    logger.debug({ 
      botId, 
      channelId, 
      total: allEntries.length,
      returned: limitedEntries.length
    }, 'Loaded tool cache with results')

    return limitedEntries
  }

  /**
   * Legacy method for backward compatibility
   */
  async loadCache(botId: string, channelId: string): Promise<ToolCall[]> {
    const entries = await this.loadCacheWithResults(botId, channelId)
    return entries.map(e => e.call)
  }

  /**
   * Parse tool calls from completion text (for prefill mode)
   * Looks for XML-formatted tool calls like: <tool_name>{"param": "value"}</tool_name>
   */
  parseToolCalls(completion: string, originalText: string): Array<{call: ToolCall, originalText: string}> {
    const results: Array<{call: ToolCall, originalText: string}> = []

    // Pattern: <tool_name>{json}</tool_name>
    const pattern = /<(\w+)>\s*(\{[\s\S]*?\})\s*<\/\1>/g
    let match

    while ((match = pattern.exec(completion)) !== null) {
      const toolName = match[1]
      const jsonInput = match[2]

      if (!toolName || !jsonInput) {
        continue
      }

      try {
        const input = JSON.parse(jsonInput.trim())
        results.push({
          call: {
            id: this.generateToolCallId(),
            name: toolName,
            input,
            messageId: '',  // Will be set later by Agent Loop
            timestamp: new Date(),
            originalCompletionText: originalText,
          },
          originalText
        })
        
        logger.debug({ toolName, input }, 'Parsed tool call from XML')
      } catch (error) {
        logger.warn({ error, match: match[0] }, 'Failed to parse tool call')
      }
    }

    return results
  }

  /**
   * Execute a tool via MCP (routes to correct server)
   */
  async executeTool(call: ToolCall): Promise<ToolResult> {
    if (this.mcpClients.size === 0) {
      throw new ToolError('No MCP clients initialized')
    }

    try {
      // Find which server provides this tool
      const toolDef = this.tools.find((t) => t.name === call.name)
      const serverName = toolDef?.serverName || 'default'
      const client = this.mcpClients.get(serverName) || this.mcpClients.values().next().value

      if (!client) {
        throw new ToolError(`No MCP client found for tool: ${call.name}`)
      }

      logger.debug({ call, server: serverName }, 'Executing tool')

      const result = await client.callTool({
        name: call.name,
        arguments: call.input,
      })

      return {
        callId: call.id,
        output: result.content,
        timestamp: new Date(),
      }
    } catch (error) {
      logger.error({ error, call }, 'Tool execution failed')

      return {
        callId: call.id,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      }
    }
  }

  /**
   * Persist tool use to JSONL file
   */
  async persistToolUse(
    botId: string,
    channelId: string,
    call: ToolCall,
    result: ToolResult
  ): Promise<void> {
    const now = new Date()
    const hour = now.toISOString().substring(0, 13).replace(/:/g, '-')
    const fileName = `${hour}.jsonl`
    const dirPath = join(this.toolCacheDir, botId, channelId)
    const filePath = join(dirPath, fileName)

    // Ensure directory exists
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }

    const entry = {
      call: {
        id: call.id,
        name: call.name,
        input: call.input,
        messageId: call.messageId,
        originalCompletionText: call.originalCompletionText,
      },
      result: {
        output: result.output,
        error: result.error,
      },
      timestamp: result.timestamp.toISOString(),
    }

    try {
      appendFileSync(filePath, JSON.stringify(entry) + '\n')
      logger.debug({ botId, channelId, tool: call.name }, 'Persisted tool use')
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to persist tool use')
    }
  }

  /**
   * Close all MCP clients
   */
  async close(): Promise<void> {
    for (const [name, client] of this.mcpClients.entries()) {
      try {
        await client.close()
        logger.info({ server: name }, 'MCP client closed')
      } catch (error) {
        logger.warn({ error, server: name }, 'Error closing MCP client')
      }
    }
    this.mcpClients.clear()
  }

  private generateToolCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substring(7)}`
  }
}

