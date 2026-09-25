export type QueuedFollowup = { id: string; steeredAt?: number }

export function nextQueuedFollowup<T extends QueuedFollowup>(items: readonly T[]): T | undefined {
  let next: T | undefined
  for (const item of items) {
    if (!next || (item.steeredAt !== undefined && (next.steeredAt === undefined || item.steeredAt < next.steeredAt))) {
      next = item
    }
  }
  return next
}

export function markFollowupSteered<T extends QueuedFollowup>(items: readonly T[], id: string, at: number): T[] {
  return items.map((item) => item.id === id && item.steeredAt === undefined ? { ...item, steeredAt: at } : item)
}

export function removeQueuedFollowup<T extends QueuedFollowup>(items: readonly T[], id: string): T[] {
  return items.filter((item) => item.id !== id)
}
