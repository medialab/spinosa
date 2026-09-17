import type { RunCommand, RunPrompt } from "./types"

export function clonePrompt(prompt: RunPrompt): RunPrompt {
  return {
    text: prompt.text,
    parts: structuredClone(prompt.parts),
    ...(prompt.mode ? { mode: prompt.mode } : {}),
    ...(prompt.command ? { command: prompt.command } : {}),
  }
}

export function emptyPrompt(shell: boolean): RunPrompt {
  return shell ? { text: "", parts: [], mode: "shell" } : { text: "", parts: [] }
}

export function removeLineRange(input: string) {
  const hash = input.lastIndexOf("#")
  return hash === -1 ? input : input.slice(0, hash)
}

export function extractLineRange(input: string) {
  const hash = input.lastIndexOf("#")
  if (hash === -1) {
    return { base: input }
  }

  const base = input.slice(0, hash)
  const line = input.slice(hash + 1)
  const match = line.match(/^(\d+)(?:-(\d*))?$/)
  if (!match) {
    return { base }
  }

  const start = Number(match[1])
  const end = match[2] && start < Number(match[2]) ? Number(match[2]) : undefined
  return { base, line: { start, end } }
}

export function slashHead(text: string) {
  if (!text.startsWith("/")) {
    return
  }

  for (let i = 1; i < text.length; i++) {
    switch (text[i]) {
      case " ":
      case "\t":
      case "\n":
        return { name: text.slice(1, i), arguments: text.slice(i + 1), end: i }
    }
  }

  return { name: text.slice(1), arguments: "", end: text.length }
}

export function slashQuery(text: string, cursor: number) {
  const head = slashHead(text.slice(0, cursor))
  if (!head || head.end !== cursor) {
    return
  }

  return head.name
}

export function parseSlashCommand(text: string, commands: RunCommand[] | undefined) {
  const head = slashHead(text)
  if (!head || head.name.length === 0) {
    return { type: "none" as const }
  }

  if (!commands) {
    return { type: "pending" as const }
  }

  if (!commands.some((item) => item.name === head.name)) {
    return { type: "none" as const }
  }

  return {
    type: "command" as const,
    command: { name: head.name, arguments: head.arguments },
  }
}

export function selectedCommand(text: string, command: RunPrompt["command"]) {
  if (!command) {
    return
  }

  const head = slashHead(text)
  if (!head || head.name !== command.name) {
    return
  }

  return {
    name: command.name,
    arguments: head.arguments,
  }
}
