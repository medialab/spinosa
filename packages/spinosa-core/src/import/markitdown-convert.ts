import { readFileSync } from "node:fs"
import path from "node:path"
import type { MarkItDown } from "@spinosa/markitdown"
import { ensureSheetJsFs } from "./sheetjs-fs"

type MarkItDownResult = Awaited<ReturnType<MarkItDown["convert"]>>

/**
 * Convert a local file with markitdown-ts.
 *
 * SheetJS 0.20+ ESM cannot `readFile` until `set_fs` is injected. For `.xlsx`
 * we also prefer buffer conversion so a mismatched xlsx module instance cannot
 * resurface as "The .xlsx are not supported."
 */
export type MarkItDownVisionOpts = {
  /** Vercel AI SDK LanguageModel (e.g. openai("gpt-4o-mini") or openrouter via createOpenAI). */
  llmModel?: unknown
  llmPrompt?: string
}

export async function createMarkItDown(): Promise<MarkItDown> {
  const { MarkItDown } = await import("@spinosa/markitdown")
  return new MarkItDown()
}

export async function markitdownConvertFile(
  converter: MarkItDown,
  src: string,
  vision?: MarkItDownVisionOpts,
): Promise<MarkItDownResult> {
  ensureSheetJsFs()
  const visionOpts =
    vision?.llmModel
      ? { llmModel: vision.llmModel as never, llmPrompt: vision.llmPrompt }
      : undefined
  const result =
    path.extname(src).toLowerCase() === ".xlsx"
      ? await converter.convertBuffer(readFileSync(src), {
        file_extension: ".xlsx",
        ...(visionOpts ? visionOpts : {}),
      } as never)
      : await converter.convert(src, visionOpts as never)
  // Structured failure: upstream `[ERROR] ...` markdown must never read as a
  // successful conversion. Throw so callers record failed/partial, not done.
  const markdown = (result as { markdown?: unknown } | null)?.markdown
  if (typeof markdown === "string" && /^\[ERROR\]/m.test(markdown.trim())) {
    throw new Error(`document conversion failed for ${path.basename(src)}: ${markdown.trim().slice(0, 300)}`)
  }
  return result
}
