const SILENT_AGENT_OUTPUT_METADATA = "spinosaSilent"

type Message = {
  role: string
  parentID?: string
}

function metadata(part: unknown): Record<string, unknown> | undefined {
  if (!part || typeof part !== "object" || !("metadata" in part)) return
  const value = part.metadata
  if (!value || typeof value !== "object") return
  return value as Record<string, unknown>
}

export function isSilentResearchAssistant(
  message: Message,
  partsByMessage: Record<string, readonly unknown[] | undefined>,
): boolean {
  if (message.role !== "assistant" || !message.parentID) return false
  return partsByMessage[message.parentID]?.some(
    (part) => metadata(part)?.[SILENT_AGENT_OUTPUT_METADATA] === true,
  ) ?? false
}
