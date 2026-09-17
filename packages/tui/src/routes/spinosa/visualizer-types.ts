import type { ToolPart } from "@spinosa/sdk/v2"
import type { DialogContext } from "../../ui/dialog"
import type { Theme } from "../../theme"

export type VisualizerMode = "timeline" | "types" | "sessions"

export type ToolCallRecord = {
  id: string
  callID?: string
  messageID?: string
  sessionID?: string
  parentSessionID?: string
  tool: string
  status: string
  input: Record<string, unknown>
  output?: string
  error?: string
  title?: string
  metadata?: Record<string, unknown>
  timeStart: number
  timeEnd?: number
  sessionTitle: string
  part: ToolPart | Record<string, never>
}

export type CanvasViewProps = {
  toolCalls: ToolCallRecord[]
  theme: Theme
  dialog: Pick<DialogContext, "replace">
}
