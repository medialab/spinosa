#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import { createHash } from "node:crypto"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import type { BunPlugin } from "bun"
import {
  assertNapiCanvasPlatformInstalled,
  materializeCanvasNativeEmbed,
  napiCanvasForceModule,
  napiCanvasPlatformPackage,
  restoreCanvasNativeStub,
} from "./canvas-embed.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

export type BinaryTarget = {
  os: "linux" | "darwin" | "win32"
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}

export type BuildSpinosaBinariesOptions = {
  /** Working directory = packages/spinosa-kernel */
  cwd?: string
  targets: BinaryTarget[]
  version: string
  channel: string
  distribution?: "binary" | "dev"
  templatePackId?: string
  templatePackVersion?: string
  /** When set, write flat product assets: <outdir>/spinosa-<os>-<arch> */
  flatOutDir?: string
  skipInstall?: boolean
  sourcemaps?: boolean
  /** Smoke host-matching binary with --version */
  smokeHost?: boolean
  /** Embed generated template pack module text (optional). */
  templatePackModule?: string | null
  /** Keep npm-style dist/<pkg>/bin/spinosa layout (default true when flatOutDir unset). */
  packageLayout?: boolean
}

function packageDirectory(name: string) {
  return name.startsWith("@spinosa/") ? name.slice("@spinosa/".length) : name
}

function createPortableDependencyPlugin(): BunPlugin {
  return {
    name: "spinosa-portable-dependencies",
    setup(build) {
      build.onLoad(
        {
          filter: /jsdom.*XMLHttpRequest-impl\.js$/,
        },
        async (args) => {
          const contents = await Bun.file(args.path).text()
          const marker =
            'const syncWorkerFile = require.resolve ? require.resolve("./xhr-sync-worker.js") : null;'
          if (!contents.includes(marker)) {
            throw new Error(
              `jsdom XMLHttpRequest source changed; portability rewrite no longer applies: ${args.path}`,
            )
          }
          return { contents: contents.replace(marker, "const syncWorkerFile = null;"), loader: "js" }
        },
      )
    },
  }
}

import os from "node:os"
const builderHome = os.homedir().replaceAll("\\", "/").replace(/\/$/, "")
const builderHomeWin = builderHome.replaceAll("/", "\\")
const repoRoot = path.resolve(__dirname, "../..").replaceAll("\\", "/")
const EMBEDDED_BUILD_PATH_PREFIXES = [
  // Rust dependency metadata can retain the Windows cache path from the
  // cross-build image. Keep this exact, known path scrubbed without masking
  // arbitrary user paths (broad C:\\Users replacement corrupts binaries).
  {
    prefix: Buffer.from(
      "C:\\Users\\silvi\\.cargo\\registry\\src\\index.crates.io-1949cf8c6b5b557f",
    ),
    replacement: Buffer.from("/spinosa/vendor"),
  },
  // Repo root first (longer) so "/Users/.../spinosa-main" scrubs to "/spinosa/repo" not "/spinosa/Documents/..."
  ...(repoRoot && repoRoot !== builderHome
    ? [{ prefix: Buffer.from(repoRoot), replacement: Buffer.from("/spinosa/repo") }]
    : []),
  ...(builderHome ? [{ prefix: Buffer.from(builderHome), replacement: Buffer.from("/spinosa") }] : []),
  ...(builderHomeWin && builderHomeWin !== builderHome
    ? [{ prefix: Buffer.from(builderHomeWin), replacement: Buffer.from("C:\\spinosa") }]
    : []),
] as const

function isEmbeddedPathByte(byte: number): boolean {
  if (byte < 0x20 || byte === 0x7f) return false
  return byte !== 0x22 && byte !== 0x27 && byte !== 0x60 && byte !== 0x2c && byte !== 0x3b
}

/** Byte range of pristine embedded file data inside the compiled binary. */
export interface EmbeddedSpan {
  start: number
  end: number
}

/**
 * Locate pristine embedded file bytes (e.g. a staged `.node` native) inside
 * the compiled binary. Bun may embed the same file asset more than once, so
 * every fullverbatim occurrence is returned. Slices are verified with a full
 * byte compare — fail closed when no complete copy is found, so the path
 * scrub can never clobber the wrong span.
 */
export function findEmbeddedSpans(haystack: Buffer, needle: Buffer): EmbeddedSpan[] {
  if (needle.byteLength < 4096) {
    throw new Error(`embedded span needle too small to locate uniquely (${needle.byteLength} bytes)`)
  }
  for (const sliceOffset of [1048576, 524288, 131072, 16384, 1024]) {
    if (sliceOffset + 256 > needle.byteLength) continue
    const slice = needle.subarray(sliceOffset, sliceOffset + 256)
    const spans: EmbeddedSpan[] = []
    let from = 0
    while (true) {
      const hit = haystack.indexOf(slice, from)
      if (hit < 0) break
      const start = hit - sliceOffset
      const end = start + needle.byteLength
      if (start >= 0 && end <= haystack.byteLength && haystack.subarray(start, end).equals(needle)) {
        spans.push({ start, end })
      }
      from = hit + 1
    }
    if (spans.length > 0) return spans
  }
  throw new Error("embedded native span not locatable — refusing to scrub (fail closed)")
}

export function spanIntersects(match: number, end: number, spans: readonly EmbeddedSpan[]): boolean {
  return spans.some((span) => match < span.end && end > span.start)
}

export function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex")
}

/**
 * Fail closed when post-scrub embedded bytes differ from pristine. This gate
 * would have caught the v1.1.0-beta.18 darwin outage (scrub corrupted the
 * staged canvas `.node`, macOS killed hosts on dlopen).
 */
export function assertEmbeddedSpanIntact(
  binaryPath: string,
  span: EmbeddedSpan,
  expectedHash: string,
  label: string,
): void {
  const bytes = fs.readFileSync(binaryPath)
  const actual = sha256Hex(bytes.subarray(span.start, span.end))
  if (actual !== expectedHash) {
    throw new Error(
      `scrub altered embedded ${label} (bytes ${span.start}..${span.end}): expected ${expectedHash}, got ${actual}`,
    )
  }
}

export function scrubEmbeddedBuildPaths(binaryPath: string, skipSpans: readonly EmbeddedSpan[] = []): number {
  const bytes = fs.readFileSync(binaryPath)
  let replacements = 0
  for (const { prefix, replacement } of EMBEDDED_BUILD_PATH_PREFIXES) {
    if (prefix.length === 0) continue
    let offset = 0
    while (true) {
      const match = bytes.indexOf(prefix, offset)
      if (match < 0) break
      let end = match + prefix.length
      while (end < bytes.length && isEmbeddedPathByte(bytes[end])) end++
      // Embedded native blobs (staged `.node` files) carry their own
      // toolchain paths — clobbering them corrupts the inner Mach-O and
      // macOS kills the host on dlopen (v1.1.0-beta.18 darwin outage).
      // Advance by one (not to `end`): the greedy extension below may run
      // far past the span, and later matches inside it need their own check.
      if (spanIntersects(match, end, skipSpans)) {
        offset = match + 1
        continue
      }
      const length = end - match
      const neutral = Buffer.alloc(length, 0x5f)
      neutral.set(replacement.subarray(0, Math.min(length, replacement.length)))
      bytes.set(neutral, match)
      replacements++
      offset = end
    }
  }
  if (replacements > 0) fs.writeFileSync(binaryPath, bytes)
  return replacements
}

export function assertNoEmbeddedBuildPaths(binaryPath: string, skipSpans: readonly EmbeddedSpan[] = []): void {
  const bytes = fs.readFileSync(binaryPath)
  for (const { prefix } of EMBEDDED_BUILD_PATH_PREFIXES) {
    if (prefix.length === 0) continue
    let offset = 0
    while (true) {
      const hit = bytes.indexOf(prefix, offset)
      if (hit < 0) break
      let end = hit + prefix.length
      while (end < bytes.length && isEmbeddedPathByte(bytes[end])) end++
      if (!spanIntersects(hit, end, skipSpans)) {
        throw new Error(`binary ${binaryPath} still contains ${prefix.toString()} at byte ${hit}`)
      }
      offset = end
    }
  }
  // Also fail on generic personal markers that should never ship.
  // Verified-pristine spans are exempt: their bytes are hash-pinned vendored
  // input (assertEmbeddedSpanIntact), so the scrub cannot act on them anyway.
  const personal = [Buffer.from("tommasoprinetti"), Buffer.from("thdxr")]
  for (const p of personal) {
    let offset = 0
    while (true) {
      const off = bytes.indexOf(p, offset)
      if (off < 0) break
      if (!spanIntersects(off, off + p.byteLength, skipSpans)) {
        throw new Error(`binary ${binaryPath} still contains personal marker ${p.toString()} at byte ${off}`)
      }
      offset = off + 1
    }
  }
}

export function productAssetName(item: BinaryTarget): string {
  const os = item.os === "win32" ? "windows" : item.os
  const parts = [os, item.arch, item.avx2 === false ? "baseline" : undefined, item.abi]
  return `spinosa-${parts.filter(Boolean).join("-")}`
}

/**
 * Bun external dependency audit (release contract — keep in sync).
 *
 * | module                | why external                          | prod reachable? | where on user machine              | tested by                          |
 * |-----------------------|---------------------------------------|-----------------|------------------------------------|------------------------------------|
 * | unzipper              | BUNDLED (compiled in) — ZIP imports   | yes             | inside spinosa binary              | zip conversion tests               |
 * | youtube-transcript    | external — URL transcription, not a   | no              | n/a (feature not advertised)       | inventory test asserts unreachable |
 * |                       | file-import path; never imported      |                 |                                    |                                    |
 * | @aws-sdk/client-s3    | external — transitive draft dep,      | no              | n/a                                | inventory test asserts unreachable |
 * |                       | never imported in src                 |                 |                                    |                                    |
 * | node-gyp              | external — build-time only, never     | no              | n/a                                | inventory test asserts unreachable |
 * |                       | imported at runtime                   |                 |                                    |                                    |
 *
 * Rule: any module needed by a production feature must be compiled into the
 * executable. Never leave an external because it happened to work in-repo.
 */

export async function buildSpinosaBinaries(options: BuildSpinosaBinariesOptions): Promise<{
  binaries: Record<string, string>
  assets: Record<string, string>
}> {
  const cwd = options.cwd ?? dir
  process.chdir(cwd)

  const generated = await import("./generate.ts")
  const pkg = await Bun.file(path.join(cwd, "package.json")).json()
  const solidPlugin = createSolidTransformPlugin()
  const coreFrom = path.resolve(cwd, "../spinosa-core")
  const plugins = [
    createPortableDependencyPlugin(),
    solidPlugin,
  ]

  const distribution = options.distribution ?? "binary"
  const templatePackId = options.templatePackId ?? ""
  const templatePackVersion = options.templatePackVersion ?? options.version

  if (!options.flatOutDir) {
    await $`rm -rf dist`.cwd(cwd)
  } else {
    fs.mkdirSync(options.flatOutDir, { recursive: true })
  }

  if (!options.skipInstall) {
    await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`.cwd(cwd)
    await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`.cwd(cwd)
    await $`bun install --os="*" --cpu="*" @ff-labs/fff-bun@${pkg.dependencies["@ff-labs/fff-bun"]}`.cwd(cwd)
    const rootPkg = (await Bun.file(path.join(cwd, "../../package.json")).json()) as {
      dependencies?: Record<string, string>
    }
    const canvasVersion = rootPkg.dependencies?.["@napi-rs/canvas"] ?? "1.0.2"
    await $`bun install --os="*" --cpu="*" @napi-rs/canvas@${canvasVersion}`.cwd(cwd)
  }

  const binaries: Record<string, string> = {}
  const assets: Record<string, string> = {}

  try {
  for (const item of options.targets) {
    const packageName = [
      pkg.name,
      item.os === "win32" ? "windows" : item.os,
      item.arch,
      item.avx2 === false ? "baseline" : undefined,
      item.abi === undefined ? undefined : item.abi,
    ]
      .filter(Boolean)
      .join("-")
    const directory = packageDirectory(packageName)
    const target = [
      "bun",
      item.os === "win32" ? "windows" : item.os,
      item.arch,
      item.avx2 === false ? "baseline" : undefined,
      item.abi === undefined ? undefined : item.abi,
    ]
      .filter(Boolean)
      .join("-")

    const assetName = productAssetName(item)
    console.log(`building ${packageName} → ${assetName}`)

    const outfile = options.flatOutDir
      ? path.join(options.flatOutDir, assetName)
      : path.join(cwd, `dist/${directory}/bin/spinosa`)

    if (!options.flatOutDir) {
      await $`mkdir -p dist/${directory}/bin`.cwd(cwd)
    }

    const localPath = path.resolve(cwd, "node_modules/@opentui/core/parser.worker.js")
    const rootPath = path.resolve(cwd, "../../node_modules/@opentui/core/parser.worker.js")
    const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
    const workerPath = "./src/cli/tui/worker.ts"
    const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
    const workerRelativePath = path.relative(cwd, parserWorker).replaceAll("\\", "/")

    const files: Record<string, string> = {}
    if (options.templatePackModule) {
      files["src/generated/template-pack.gen.ts"] = options.templatePackModule
    }

    // OCR is the Spinosa-owned bundled Tesseract (external binary + tessdata
    // release assets, not a Bun module) — nothing to embed here.
    console.log(`canvas-only native embed for ${item.os}-${item.arch}`)

    const canvasTarget = { os: item.os, arch: item.arch, abi: item.abi }
    const canvasPkg = napiCanvasPlatformPackage(canvasTarget)
    assertNapiCanvasPlatformInstalled(canvasTarget, coreFrom)
    // Embed skia.<triple>.node on disk (template-blobs pattern). Nested
    // OCR chunks cannot require() optional @napi-rs/canvas-* on Linux compile;
    // index.ts stages this file and sets NAPI_RS_NATIVE_LIBRARY_PATH first.
    const canvasEmbed = materializeCanvasNativeEmbed({
      cwd,
      target: canvasTarget,
      fromDir: coreFrom,
    })
    console.log(
      `embedding canvas native for ${item.os}-${item.arch}: ${canvasEmbed.name} (${fs.statSync(path.join(canvasEmbed.libsDir, canvasEmbed.name)).size} bytes)`,
    )
    // Package-only force module stays on the virtual files map (writing it to disk
    // breaks Bun resolution of optional @napi-rs/canvas-* platform packages).
    files["src/generated/napi-canvas-force.gen.ts"] = napiCanvasForceModule(canvasPkg)
    console.log(`embedding ${canvasPkg} for ${item.os}-${item.arch}`)

    const result = await Bun.build({
      conditions: ["bun", "node"],
      tsconfig: "./tsconfig.json",
      plugins,
      // unzipper is BUNDLED (ZIP imports are an advertised feature — the
      // markitdown-ts ZipConverter dynamic-imports it at runtime, which
      // fails inside the compiled binary unless compiled in). The remaining
      // externals are unreachable in production file import (see audit above).
      external: ["node-gyp", "@aws-sdk/client-s3", "youtube-transcript"],
      format: "esm",
      minify: true,
      sourcemap: options.sourcemaps ? "linked" : "none",
      splitting: true,
      compile: {
        autoloadBunfig: false,
        autoloadDotenv: false,
        autoloadTsconfig: true,
        autoloadPackageJson: true,
        target: target as any,
        outfile,
        execArgv: [`--user-agent=spinosa/${options.version}`, "--use-system-ca", "--"],
        windows: {},
      },
      files,
      entrypoints: ["./src/index.ts", parserWorker, workerPath],
      define: {
        FFF_LIBC: JSON.stringify(item.abi === "musl" ? "musl" : "gnu"),
        SPINOSA_VERSION: `'${options.version}'`,
        SPINOSA_MODELS_DEV: generated.modelsData,
        OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
        SPINOSA_WORKER_PATH: workerPath,
        SPINOSA_CHANNEL: `'${options.channel}'`,
        SPINOSA_DISTRIBUTION: `'${distribution}'`,
        SPINOSA_TEMPLATE_PACK_ID: `'${templatePackId}'`,
        SPINOSA_TEMPLATE_PACK_VERSION: `'${templatePackVersion}'`,
        SPINOSA_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
        ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(item.abi ?? "glibc") } : {}),
      },
    })

    if (!result.success) {
      console.error(result.logs)
      throw new Error(`Bun.build failed for ${packageName}`)
    }

    if (!fs.existsSync(outfile) || fs.statSync(outfile).size < 1024) {
      throw new Error(`binary missing or too small: ${outfile}`)
    }
    fs.chmodSync(outfile, 0o755)

    // Fail closed: companion lib bytes must appear in the compiled binary.
    // Bun renames `with { type: "file" }` assets (hashed filenames), so path
    // strings are not a reliable marker — fingerprint the lib contents instead.
    const binBytes = fs.readFileSync(outfile)

    // Same fingerprint gate for canvas skia .node (OCR load path on Linux).
    // Locate the pristine span now: the scrub below must never touch it —
    // clobbered inner Mach-O bytes kill the host on dlopen under macOS
    // code-signing enforcement (v1.1.0-beta.18 darwin outage).
    const canvasLibPath = path.join(canvasEmbed.libsDir, canvasEmbed.name)
    const canvasLibData = fs.readFileSync(canvasLibPath)
    if (canvasLibData.byteLength < 1024) {
      throw new Error(`canvas native too small to fingerprint: ${canvasLibPath}`)
    }
    if (binBytes.byteLength < canvasLibData.byteLength) {
      throw new Error(
        `binary ${outfile} (${binBytes.byteLength} bytes) smaller than canvas native ${canvasEmbed.name} (${canvasLibData.byteLength} bytes)`,
      )
    }
    const probeAt = Math.min(4096, canvasLibData.byteLength - 64)
    const probe = canvasLibData.subarray(probeAt, probeAt + 64)
    if (!binBytes.includes(probe)) {
      throw new Error(
        `binary ${outfile} missing embedded bytes for ${canvasEmbed.name} (${item.os}-${item.arch}) — canvas native not packaged`,
      )
    }
    const canvasSpans = findEmbeddedSpans(binBytes, canvasLibData)
    const canvasHash = sha256Hex(canvasLibData)

    const scrubbedPaths = scrubEmbeddedBuildPaths(outfile, canvasSpans)
    assertNoEmbeddedBuildPaths(outfile, canvasSpans)
    for (const span of canvasSpans) {
      assertEmbeddedSpanIntact(outfile, span, canvasHash, `canvas native ${canvasEmbed.name}`)
    }
    if (process.platform === "darwin" && item.os === "darwin") {
      const signed = await $`codesign --force --sign - ${outfile}`.nothrow()
      if (signed.exitCode !== 0) throw new Error(`failed to re-sign sanitized binary: ${outfile}`)
    }
    if (scrubbedPaths > 0) {
      console.log(`scrubbed ${scrubbedPaths} embedded build path${scrubbedPaths === 1 ? "" : "s"} from ${assetName}`)
    }

    if (
      options.smokeHost !== false &&
      item.os === process.platform &&
      item.arch === process.arch &&
      !item.abi
    ) {
      console.log(`Running smoke test: ${outfile} version`)
      try {
        const versionOutput = await $`${outfile} version`.text()
        console.log(`Smoke test passed: ${versionOutput.trim()}`)
        if (!versionOutput.includes(options.version)) {
          throw new Error(`version smoke mismatch: expected ${options.version}, got ${versionOutput}`)
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        // Release gates fail closed: smoke failures are fatal (no non-strict
        // escape hatch — see scripts/quality-binary.ts).
        console.error(`Smoke test failed for ${packageName}:`, e)
        throw new Error(`host binary smoke failed (fail closed): ${detail.slice(0, 400)}`)
      }
    }

    if (!options.flatOutDir) {
      await $`rm -rf ./dist/${directory}/bin/tui`.cwd(cwd)
      await Bun.file(`dist/${directory}/package.json`).write(
        JSON.stringify(
          {
            name: packageName,
            version: options.version,
            preferUnplugged: true,
            os: [item.os],
            cpu: [item.arch],
            ...(item.abi ? { libc: [item.abi] } : {}),
          },
          null,
          2,
        ),
      )
    }

    binaries[packageName] = options.version
    assets[assetName] = outfile
  }
  } finally {
    restoreCanvasNativeStub(cwd)
  }

  return { binaries, assets }
}

// CLI entry when run directly
if (import.meta.main) {
  const singleFlag = process.argv.includes("--single")
  const baselineFlag = process.argv.includes("--baseline")
  const skipInstall = process.argv.includes("--skip-install")
  const sourcemapsFlag = process.argv.includes("--sourcemaps")
  const { Script } = await import("@spinosa/script")

  const allTargets: BinaryTarget[] = [
    { os: "linux", arch: "arm64" },
    { os: "linux", arch: "x64" },
    { os: "linux", arch: "x64", avx2: false },
    { os: "linux", arch: "arm64", abi: "musl" },
    { os: "linux", arch: "x64", abi: "musl" },
    { os: "linux", arch: "x64", abi: "musl", avx2: false },
    { os: "darwin", arch: "arm64" },
    { os: "darwin", arch: "x64" },
    { os: "darwin", arch: "x64", avx2: false },
    { os: "win32", arch: "arm64" },
    { os: "win32", arch: "x64" },
    { os: "win32", arch: "x64", avx2: false },
  ]

  const targets = singleFlag
    ? allTargets.filter((item) => {
        if (item.os !== process.platform || item.arch !== process.arch) return false
        if (item.avx2 === false) return baselineFlag
        if (item.abi !== undefined) return false
        return true
      })
    : allTargets

  await buildSpinosaBinaries({
    targets,
    version: Script.version,
    channel: Script.channel,
    distribution: "binary",
    skipInstall,
    sourcemaps: sourcemapsFlag,
  })
}
