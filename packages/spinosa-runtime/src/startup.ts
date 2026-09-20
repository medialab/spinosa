/** True when the prompt is the workspace startup / indexing brief (orchestrator-only). */
export function isStartupIndexingPrompt(prompt: string): boolean {
  const text = prompt.trim()
  if (!text) return false

  if (/^#\s*Index This Workspace\b/m.test(text)) return true
  if (/startup-prompt\.md/i.test(text)) return true
  if (/Run Spinosa startup indexing/i.test(text)) return true
  if (/setup_status:\s*cli_started/i.test(text)) return true
  if (/Do not invoke [`']?spinosa-overseer/i.test(text)) return true
  // Everyday asks ("index this workspace") — not only the canned trigger.
  if (/\bindex(?:ing)?\s+(?:this|the|my)\s+workspace\b/i.test(text)) return true
  if (/\b(?:start|run|begin)\s+(?:the\s+)?(?:startup\s+)?indexing\b/i.test(text)) return true

  return false
}
