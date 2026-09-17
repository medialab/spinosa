#!/usr/bin/env bun
/**
 * Release dependency inventory (release hardening #30).
 *
 * Generates a machine-readable inventory during build describing the compiled
 * runtime, external modules, bundled native libs, and PDF engine
 * implementation. No OCR engine ships (no language data, no tools
 * archives). Unexpected runtime externals fail the release (fail closed).
 *
 * Usage: bun scripts/release/inventory.ts [--check] [--out <path>]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")

const EXPECTED_EXTERNALS = ["node-gyp", "@aws-sdk/client-s3", "youtube-transcript"] as const
const BUNDLED_REQUIRED = ["unzipper"] as const

export type DependencyInventory = {
  product: "spinosa"
  version: string
  runtime: "bun-compile"
  externals: string[]
  bundledModules: string[]
  pdfEngine: "pdfjs-dist + @napi-rs/canvas (internal pdf/ subsystem, no poppler/pdftoppm)"
  ocrEngine: "removed"
  nativeBindings: string[]
}

function readBuildExternals(): string[] {
  const buildTs = readFileSync(path.join(root, "packages/spinosa-kernel/script/build.ts"), "utf-8")
  const match = buildTs.match(/external:\s*\[([^\]]*)\]/)
  if (!match) return []
  return [...match[1]!.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!)
}

export function buildInventory(): DependencyInventory {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as { version: string }
  const externals = readBuildExternals()
  return {
    product: "spinosa",
    version: pkg.version,
    runtime: "bun-compile",
    externals,
    bundledModules: [...BUNDLED_REQUIRED],
    pdfEngine: "pdfjs-dist + @napi-rs/canvas (internal pdf/ subsystem, no poppler/pdftoppm)",
    ocrEngine: "removed",
    nativeBindings: ["@napi-rs/canvas skia (per-platform)"],
  }
}

/** Fail closed on unexpected runtime externals. */
export function assertInventoryClean(inv: DependencyInventory): void {
  const unexpected = inv.externals.filter((e) => !(EXPECTED_EXTERNALS as readonly string[]).includes(e))
  if (unexpected.length > 0) {
    throw new Error(`unexpected runtime externals (fail closed): ${unexpected.join(", ")} — bundle them or document in build.ts audit table`)
  }
  for (const mod of BUNDLED_REQUIRED) {
    if (inv.externals.includes(mod)) {
      throw new Error(`required bundled module is external: ${mod} — ZIP imports would fail from the shipped executable`)
    }
  }
}

if (import.meta.main) {
  const checkOnly = process.argv.includes("--check")
  const outIdx = process.argv.indexOf("--out")
  const inv = buildInventory()
  assertInventoryClean(inv)
  const text = `${JSON.stringify(inv, null, 2)}\n`
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    writeFileSync(process.argv[outIdx + 1]!, text)
    console.log(`✓ dependency inventory → ${process.argv[outIdx + 1]}`)
  } else if (!checkOnly) {
    console.log(text)
  } else {
    console.log("✓ dependency inventory clean")
  }
  void existsSync
}
