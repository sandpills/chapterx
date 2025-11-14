/**
 * Retry utilities with exponential backoff
 */

import { logger } from './logger.js'

export interface RetryOptions {
  maxAttempts: number
  initialDelay?: number
  maxDelay?: number
  exponential?: boolean
  onRetry?: (error: Error, attempt: number) => void
}

/**
 * Retry a function with configurable backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxAttempts,
    initialDelay = 1000,
    maxDelay = 32000,
    exponential = true,
    onRetry,
  } = options

  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      if (attempt === maxAttempts) {
        break
      }

      // Call retry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt)
      }

      // Calculate delay
      let delay = initialDelay
      if (exponential) {
        delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay)
      }

      logger.warn(
        {
          error: lastError.message,
          attempt,
          maxAttempts,
          delayMs: delay,
        },
        'Retrying after error'
      )

      await sleep(delay)
    }
  }

  throw lastError
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry for LLM calls (no exponential backoff, fixed retry count)
 */
export async function retryLLM<T>(
  fn: () => Promise<T>,
  maxAttempts: number
): Promise<T> {
  return retryWithBackoff(fn, {
    maxAttempts,
    initialDelay: 1000,
    exponential: false,
  })
}

/**
 * Retry for Discord API calls (exponential backoff with cap)
 */
export async function retryDiscord<T>(
  fn: () => Promise<T>,
  maxBackoffMs: number = 32000
): Promise<T> {
  return retryWithBackoff(fn, {
    maxAttempts: 10,  // Generous retry count for Discord
    initialDelay: 1000,
    maxDelay: maxBackoffMs,
    exponential: true,
  })
}

