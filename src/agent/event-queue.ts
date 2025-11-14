/**
 * Event Queue
 * Simple thread-safe in-memory queue with batching support
 */

import { Event } from '../types.js'

export class EventQueue {
  private queue: Event[] = []

  /**
   * Push an event to the queue (thread-safe)
   */
  push(event: Event): void {
    this.queue.push(event)
  }

  /**
   * Poll a batch of events
   * Returns all consecutive Discord events (same type category)
   */
  pollBatch(): Event[] {
    if (this.queue.length === 0) {
      return []
    }

    const batch: Event[] = []
    const firstEvent = this.queue.shift()

    if (!firstEvent) {
      return []
    }

    batch.push(firstEvent)

    // Continue pulling events of similar types
    // (message, reaction, edit, delete are Discord events)
    // (self_activation, timer, internal are not)
    const isDiscordEvent = this.isDiscordEvent(firstEvent)

    while (this.queue.length > 0) {
      const nextEvent = this.queue[0]

      if (!nextEvent) {
        break
      }

      // Stop if we hit a different event category
      if (this.isDiscordEvent(nextEvent) !== isDiscordEvent) {
        break
      }

      batch.push(this.queue.shift()!)
    }

    return batch
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.length
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = []
  }

  private isDiscordEvent(event: Event): boolean {
    return ['message', 'reaction', 'edit', 'delete'].includes(event.type)
  }
}

