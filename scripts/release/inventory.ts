#!/usr/bin/env bun
/**
 * Release dependency inventory (release hardening #30).
 *
 * Generates a machine-readable inventory during build describing the compiled
 * runtime, external modules, bundled Tesseract version, bundled native libs,
 * tessdata versions/hashes, and PDF engine implementation. Unexpected runtime
 * externals fail the release (fail closed).
 *
 * Usage: bun scripts/release/inventory.ts [--check] [--out <path>]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { SOURCE_PINS, TESSERACT_VERSION } from "./tools-target.ts"

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
  ocrEngine: "bundled-tesseract"
  toolsBuild: { tesseract: string; leptonica: string }
  nativeBindings: string[]
  tessdata: { commit: string; files: Record<string, string> }
}

function readBuildExternals(): string[] {
  const buildTs = readFileSync(path.join(root, "packages/spinosa-kernel/script/build.ts"), "utf-8")
  const match = buildTs.match(/external:\s*\[([^\]]*)\]/)
  if (!match) return []
  return [...match[1]!.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!)
}

function tessdataPins(): { commit: string; files: Record<string, string> } {
  const installSh = readFileSync(path.join(root, "install.sh"), "utf-8")
  const commit = installSh.match(/^TESSDATA_PIN_COMMIT="([^"]+)"/m)?.[1] ?? "unknown"
  const files: Record<string, string> = {}
  for (const lang of ["eng", "fra", "ita"] as const) {
    const sha = installSh.match(new RegExp(`^TESSDATA_SHA_${lang}="([^"]+)"`, "m"))?.[1]
    if (sha) files[`${lang}.traineddata`] = sha
  }
  return { commit, files }
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
    ocrEngine: "bundled-tesseract",
    toolsBuild: {
      tesseract: TESSERACT_VERSION,
      leptonica: SOURCE_PINS.find((p) => p.file.startsWith("leptonica-"))?.version ?? "unknown",
    },
    nativeBindings: ["@napi-rs/canvas skia (per-platform)"],
    tessdata: tessdataPins(),
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
  if (inv.tessdata.commit === "unknown" || inv.tessdata.commit.includes("main")) {
    throw new Error("tessdata must pin an immutable commit SHA, never a mutable branch")
  }
  for (const [file, sha] of Object.entries(inv.tessdata.files)) {
    if (!/^[0-9a-f]{64}$/i.test(sha)) throw new Error(`tessdata ${file} missing pinned SHA256`)
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
