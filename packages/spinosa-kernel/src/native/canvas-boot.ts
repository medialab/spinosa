/**
 * Commands that must dlopen canvas at process start.
 *
 * TUI boot does not: canvas/pdf load when the onboarding tools check
 * (or first PDF convert) calls `ensureDocumentConverters`.
 * `SPINOSA_SKIP_CANVAS_STAGE=1` forces the skip (restricted hosts).
 */
export function commandNeedsCanvas(argv: string[]): boolean {
  if (process.env.SPINOSA_SKIP_CANVAS_STAGE === "1") return false
  const words = argv.filter((a) => !a.startsWith("-"))
  const [cmd, sub, subsub] = words
  if (cmd === "doctor") return true
  if (cmd === "internal" && sub === "smoke") {
    return subsub === "native-imports" || subsub === "pdf-runtime"
  }
  return false
}
