export function toolPartsFingerprint(
  messages: readonly { id: string }[],
  partsByMessage: Record<string, Array<{ type: string; callID?: string; tool?: string; state?: { status?: string } }>>,
): string {
  const bits: string[] = []
  for (const message of messages) {
    for (const part of partsByMessage[message.id] ?? []) {
      if (part.type !== "tool") continue
      bits.push(`${part.callID ?? ""}:${part.tool ?? ""}:${part.state?.status ?? ""}`)
    }
  }
  return bits.join("|")
}
