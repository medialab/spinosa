import type { Message, Part, Session } from "@spinosa/sdk/v2/client"

// Matches the exact `{ info, messages: [{ info, parts }] }` structure produced by `opencode export` CLI
export type SessionExportData = {
  info: Session
  messages: {
    info: Message
    parts: Part[]
  }[]
}

export type SessionExportClient = {
  session: {
    get: (input: { sessionID: string }) => Promise<{ data?: Session | null }>
    messages: (input: { sessionID: string }) => Promise<{ data?: SessionExportData["messages"] | null }>
  }
}

export async function fetchSessionExport(input: {
  sessionID: string
  client: SessionExportClient
}): Promise<SessionExportData> {
  const [sessionRes, messagesRes] = await Promise.all([
    input.client.session.get({ sessionID: input.sessionID }),
    input.client.session.messages({ sessionID: input.sessionID }),
  ])

  if (!sessionRes?.data) {
    throw new Error(`Session not found: ${input.sessionID}`)
  }
  if (!messagesRes?.data) {
    throw new Error(`Failed to load messages for session: ${input.sessionID}`)
  }

  return {
    info: sessionRes.data,
    messages: messagesRes.data,
  }
}

export function sessionExportFilename(session: { id: string; title?: string; slug?: string }, ext = "json") {
  const name = session.title || session.slug || session.id
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
  return `${clean || session.id}.${ext}`
}

function messageText(message: { info: Message; parts: Part[] }, includeThinking: boolean): { role: string; body: string } {
  const info = message.info as unknown as Record<string, unknown>
  const role = (info.role as string | undefined) ?? (info.type as string | undefined) ?? "message"
  const chunks: string[] = []
  for (const part of message.parts ?? []) {
    const item = part as unknown as Record<string, unknown>
    if (!includeThinking && (item.type === "reasoning" || item.type === "reasoning-part")) continue
    if (typeof item.text === "string" && item.text) chunks.push(item.text)
    else if (typeof item.content === "string" && item.content) chunks.push(item.content)
    else if (item.type === "tool" || item.type === "tool-call") chunks.push(`[tool: ${(item.name as string) ?? (item.callID as string) ?? "call"}]`)
    else if (item.type === "file") chunks.push(`[file: ${(item.path as string) ?? (item.url as string) ?? "attachment"}]`)
  }
  return { role, body: chunks.join("\n\n") || "(no text content)" }
}

export function renderSessionExportMarkdown(data: SessionExportData, includeThinking: boolean): string {
  const title = data.info.title || data.info.id
  const lines = [`# ${title}`, ""]
  for (const message of data.messages) {
    const { role, body } = messageText(message, includeThinking)
    lines.push(`## ${role}`, "", body, "")
  }
  return lines.join("\n")
}

export function renderSessionExportText(data: SessionExportData, includeThinking: boolean): string {
  const lines = [`${data.info.title || data.info.id}`, ""]
  for (const message of data.messages) {
    const { role, body } = messageText(message, includeThinking)
    lines.push(`[${role}]`, body, "")
  }
  return lines.join("\n")
}

export function downloadSessionExportText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadSessionExport(filename: string, data: unknown) {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
