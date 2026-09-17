import { SessionV1 } from "@spinosa/kernel-core/v1/session"

export function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }
    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }
    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }
    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined
    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }
  return Buffer.from(bytes).toString()
}

export function snapshotRange(messages: ReadonlyArray<Pick<SessionV1.WithParts, "parts">>) {
  let from: string | undefined
  let to: string | undefined
  for (const item of messages) {
    if (!from) {
      const start = item.parts.find((part) => part.type === "step-start" && part.snapshot)
      if (start?.type === "step-start") from = start.snapshot
    }
    for (const part of item.parts) {
      if (part.type === "step-finish" && part.snapshot) to = part.snapshot
    }
  }
  return from && to ? { from, to } : undefined
}
