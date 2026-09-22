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

const jsoncEsm = fileURLToPath(import.meta.resolve("jsonc-parser/lib/esm/main.js"))
const sqliteShim = path.resolve(dir, "scripts/sqlite-node-shim.ts")

const result = await Bun.build({
  target: "node",
  entrypoints: ["./scripts/server-entry.ts"],
  outdir: "../spinosa-kernel/dist/node",
  format: "esm",
  sourcemap: "linked",
  // jsonc-parser ships UMD as main: bundling it breaks on its relative
  // siblings and externalizing it breaks named ESM imports under plain
  // Node (cjs-module-lexer misses the UMD factory). Alias the ESM build.
  external: ["@lydell/node-pty", "@aws-sdk/client-s3"],
  plugins: [
    {
      name: "spinosa:jsonc-esm",
      setup(build) {
        build.onResolve({ filter: /^jsonc-parser$/ }, () => ({ path: jsoncEsm }))
        // node:sqlite StatementSync lacks setReturnArrays (bun:sqlite API
        // the kernel's Node driver calls). Route the builtin through the
        // desktop-owned interop shim; the shim's own import stays external.
        // See scripts/sqlite-node-shim.ts.
        build.onResolve({ filter: /^node:sqlite$/ }, (args) =>
          args.importer.endsWith("sqlite-node-shim.ts") ? { external: true } : { path: sqliteShim },
        )
      },
    },
  ],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  throw new Error("spinosa server bundle build failed")
}

console.log("Spinosa server bundle complete")
