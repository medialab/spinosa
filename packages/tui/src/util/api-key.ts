/**
 * API-key input hygiene for every credential prompt (vision picker,
 * /connect, local wizard). Pasted secrets routinely arrive with surrounding
 * whitespace, a trailing newline, or a `Bearer ` prefix copied from docs —
 * and once saved verbatim, every request 401s with no hint why.
 * Secrets never legitimately contain whitespace, so normalize hard here.
 */

/** Trim ends + strip a pasted `Bearer ` prefix. Never returns whitespace. */
export function normalizeApiKeyInput(raw: string): string {
  return raw.trim().replace(/^Bearer\s+/i, "")
}

/**
 * Why a raw pasted value is unusable, or undefined when it can be saved
 * (after normalizeApiKeyInput). Checked BEFORE any auth.set so garbage like
 * multi-line terminal output can never become a stored credential.
 */
export function apiKeyInputError(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return "empty — paste the API key, then submit"
  const key = trimmed.replace(/^Bearer\s+/i, "")
  if (/\s/.test(key)) return "key contains spaces or line breaks — paste the key alone, without extra text"
  if (!/^[\x21-\x7E]+$/.test(key)) return "key contains invalid characters — paste the key alone"
  if (key.length < 8) return "key is too short to be valid — paste the full key"
  return undefined
}
