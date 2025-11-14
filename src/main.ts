/**
 * Chapter3 - Discord Bot Framework
 * Main entry point
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { EventQueue } from './agent/event-queue.js'
import { AgentLoop } from './agent/loop.js'
import { ChannelStateManager } from './agent/state-manager.js'
import { DiscordConnector } from './discord/connector.js'
import { ConfigSystem } from './config/system.js'
import { ContextBuilder } from './context/builder.js'
import { LLMMiddleware } from './llm/middleware.js'
import { AnthropicProvider } from './llm/providers/anthropic.js'
import { ToolSystem } from './tools/system.js'
import { logger } from './utils/logger.js'

async function main() {
  try {
    logger.info('Starting Chapter3 bot framework')

    // Get configuration paths
    const configPath = process.env.CONFIG_PATH || './config'
    const toolsPath = process.env.TOOLS_PATH || './tools'
    const cachePath = process.env.CACHE_PATH || './cache'

    // Read Discord token from file in working directory
    const tokenFilePath = join(process.cwd(), 'discord_token')
    let discordToken: string
    
    try {
      discordToken = readFileSync(tokenFilePath, 'utf-8').trim()
      logger.info({ tokenFile: tokenFilePath }, 'Discord token loaded from file')
    } catch (error) {
      logger.error({ error, tokenFile: tokenFilePath }, 'Failed to read discord_token file')
      throw new Error('Could not read discord_token file. Please create a file named "discord_token" with your bot token.')
    }

    if (!discordToken) {
      throw new Error('discord_token file is empty')
    }

    logger.info({ configPath, toolsPath, cachePath }, 'Configuration loaded')

    // Initialize components
    const queue = new EventQueue()
    const stateManager = new ChannelStateManager()
    const configSystem = new ConfigSystem(configPath)
    const contextBuilder = new ContextBuilder()
    const llmMiddleware = new LLMMiddleware()
    const toolSystem = new ToolSystem(toolsPath)

    // Load vendor configs and register providers
    const vendorConfigs = configSystem.loadVendors()
    llmMiddleware.setVendorConfigs(vendorConfigs)

    // Register Anthropic provider if configured
    const anthropicConfig = vendorConfigs['anthropic'] || vendorConfigs['anthropic-steering-preview'] || vendorConfigs['anthropic-antra']
    if (anthropicConfig?.config.anthropic_api_key) {
      const provider = new AnthropicProvider(anthropicConfig.config.anthropic_api_key)
      llmMiddleware.registerProvider(provider)
      logger.info('Registered Anthropic provider')
    }

    // TODO: Register other providers (Bedrock, OpenAI, Google)

    // Note: MCP servers are initialized on first bot activation
    // They are configured in bot config and can be overridden per-guild/channel

    // Initialize Discord connector
    const connector = new DiscordConnector(queue, {
      token: discordToken,
      cacheDir: cachePath + '/images',
      maxBackoffMs: 32000,
    })

    await connector.start()

    // Get bot's Discord identity
    const botUserId = connector.getBotUserId()
    const botUsername = connector.getBotUsername()
    
    if (!botUserId || !botUsername) {
      throw new Error('Failed to get bot identity from Discord')
    }

    // Use Discord username as bot name for config loading
    logger.info({ botUsername, botUserId }, 'Bot identity established')

    // Create and start agent loop (using Discord username as bot ID for config)
    const agentLoop = new AgentLoop(
      botUsername,  // Bot name is derived from Discord username, not env var
      queue,
      connector,
      stateManager,
      configSystem,
      contextBuilder,
      llmMiddleware,
      toolSystem
    )

    // Set bot's Discord user ID for mention detection
    agentLoop.setBotUserId(botUserId)

    // Handle shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down')

      agentLoop.stop()
      await connector.close()
      await toolSystem.close()

      process.exit(0)
    }

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))

    // Start the loop
    await agentLoop.run()

  } catch (error) {
    logger.fatal({ error }, 'Fatal error')
    process.exit(1)
  }
}

// Run
main().catch((error) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})

