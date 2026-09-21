#!/usr/bin/env bun
/**
 * Build the desktop sidecar server bundle: Spinosa kernel `Server` compiled
 * for plain Node (Electron `utilityProcess` cannot run the Bun runtime).
 * Output mirrors the historic opencode layout so `electron.vite.config.ts`
 * resolves `virtual:spinosa-server` from `../spinosa-kernel/dist/node`.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(dir)

const result = await Bun.build({
  target: "node",
  entrypoints: ["./scripts/server-entry.ts"],
  outdir: "../spinosa-kernel/dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["@lydell/node-pty", "@aws-sdk/client-s3", "jsonc-parser"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  throw new Error("spinosa server bundle build failed")
}

console.log("Spinosa server bundle complete")
