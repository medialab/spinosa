/**
 * Product entry. `--version` / `-v` / `version` exit here so the TUI preload
 * and command graph never load. Everything else continues in `boot-runtime.ts`.
 */
import { tryHandleFastCli } from "./cli/fast-path"

if (tryHandleFastCli(process.argv)) {
  process.exit(0)
}

await import("./boot-runtime.ts")
