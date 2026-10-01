export type OutputFormat = "human" | "json" | "quiet"

export function getFormat(argv: { json?: boolean; quiet?: boolean }): OutputFormat {
  if (argv.json) return "json"
  if (argv.quiet) return "quiet"
  return "human"
}

export function getFormatFromRecord(argv: Record<string, unknown>): OutputFormat {
  if (argv["json"]) return "json"
  if (argv["quiet"]) return "quiet"
  return "human"
}

export function log(format: OutputFormat, message: string): void {
  if (format === "human") process.stdout.write(`${message}\n`)
  else if (format === "json") process.stderr.write(`${message}\n`)
}

export function logProgress(
  format: OutputFormat,
  phase: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  if (format === "quiet") return
  if (format === "json") {
    process.stderr.write(
      `${JSON.stringify({ type: "progress", phase, message, ...(detail ?? {}) })}\n`,
    )
    return
  }
  process.stdout.write(`${message}\n`)
}

export function errorOut(format: OutputFormat, message: string): void {
  process.stderr.write(`${message}\n`)
}

export function emitResult(
  format: OutputFormat,
  command: string,
  data: Record<string, unknown>,
  summary: string,
): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ command, ...data })}\n`)
  } else if (format === "human" && summary) {
    process.stdout.write(`${summary}\n`)
  }
}
