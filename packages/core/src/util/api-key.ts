/** Normalize a pasted provider key before it reaches any credential store. */
export function normalizeApiKeyInput(raw: string): string {
  return raw.trim().replace(/^Bearer\s+/i, "")
}

/** The TUI's credential-input checks, shared with Desktop. */
export function apiKeyInputError(raw: string): string | undefined {
  const key = normalizeApiKeyInput(raw)
  if (!key) return "empty — paste the API key, then submit"
  if (/\s/.test(key)) return "key contains spaces or line breaks — paste the key alone, without extra text"
  if (!/^[\x21-\x7E]+$/.test(key)) return "key contains invalid characters — paste the key alone"
  if (key.length < 8) return "key is too short to be valid — paste the full key"
  return undefined
}
