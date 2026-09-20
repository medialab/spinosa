import { hideBin } from "yargs/helpers"
import { InstallationVersion } from "@spinosa/kernel-core/installation/version"

const GLOBAL_FLAGS = new Set(["--print-logs", "--verbose", "--pure"])

export function stripGlobalCliFlags(args: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (GLOBAL_FLAGS.has(arg)) continue
    if (arg === "--log-level") {
      i++
      continue
    }
    if (arg.startsWith("--log-level=")) continue
    out.push(arg)
  }
  return out
}

export function isBareVersionArgv(args: readonly string[]): boolean {
  const meaningful = stripGlobalCliFlags(args)
  if (meaningful.length === 0) return false
  const others = meaningful.filter((arg) => arg !== "-v" && arg !== "--version" && arg !== "version")
  if (others.length > 0) return false
  return meaningful.some((arg) => arg === "-v" || arg === "--version" || arg === "version")
}

export function formatBareVersionOutput(args: readonly string[]): string {
  const meaningful = stripGlobalCliFlags(args)
  if (meaningful.includes("version")) return `spinosa ${InstallationVersion}`
  return InstallationVersion
}

/** Handle `spinosa -v` / `--version` / `version` without loading the TUI graph. */
export function tryHandleFastCli(
  argv: readonly string[] = process.argv,
  write: (text: string) => void = (text) => {
    process.stdout.write(text)
  },
): boolean {
  const args = hideBin([...argv])
  if (!isBareVersionArgv(args)) return false
  write(`${formatBareVersionOutput(args)}\n`)
  return true
}
