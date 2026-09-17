import { Schema } from "effect"
import { SessionV1 } from "@spinosa/kernel-core/v1/session"
import type { LLMEvent } from "@spinosa/llm"
import { isRecord } from "@/util/record"

const DOOM_LOOP_THRESHOLD = 3

export interface ToolResultOutput {
  title: string
  metadata: Record<string, unknown>
  output: string
  attachments?: SessionV1.FilePart[]
}

const isFilePart = (value: unknown): value is SessionV1.FilePart => Schema.is(SessionV1.FilePart)(value)

/** Normalize provider output before it is persisted as a completed tool part. */
export const toolResultOutput = (value: Extract<LLMEvent, { type: "tool-result" }>): ToolResultOutput => {
  if (isRecord(value.result.value) && typeof value.result.value.output === "string") {
    return {
      title: typeof value.result.value.title === "string" ? value.result.value.title : value.name,
      metadata: isRecord(value.result.value.metadata) ? value.result.value.metadata : {},
      output: value.result.value.output,
      attachments: Array.isArray(value.result.value.attachments)
        ? value.result.value.attachments.filter(isFilePart)
        : undefined,
    }
  }

  return {
    title: value.name,
    metadata: value.result.type === "json" && isRecord(value.result.value) ? value.result.value : {},
    output: typeof value.result.value === "string" ? value.result.value : (JSON.stringify(value.result.value) ?? ""),
  }
}

/** Detect repeated completed calls that should require explicit user approval. */
export const isDoomLoop = (
  parts: ReadonlyArray<SessionV1.Part>,
  toolName: string,
  input: Record<string, unknown>,
): boolean => {
  const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)
  return (
    recentParts.length === DOOM_LOOP_THRESHOLD &&
    recentParts.every(
      (part) =>
        part.type === "tool" &&
        part.tool === toolName &&
        part.state.status !== "pending" &&
        JSON.stringify(part.state.input) === JSON.stringify(input),
    )
  )
}
