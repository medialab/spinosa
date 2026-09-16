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
import { compiledTuiWorkerPath } from "../src/cli/tui/worker-boot.ts"

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

/** Modules that must compile from the workspace, never `$HOME/node_modules`. */
export const WORKSPACE_BUNDLED_MODULE_NAMES = ["unzipper", "markitdown-ts"] as const

export function workspaceBundledModuleFromDir(): string {
  return path.resolve(dir, "../spinosa-markitdown")
}

/**
 * Pin unzipper / markitdown-ts to the workspace copy.
 * Bun compile otherwise walks from kernel cwd into `$HOME/node_modules/markitdown-ts`,
 * which has no unzipper (local soak failure on darwin-arm64).
 */
export function resolveWorkspaceBundledModule(
  specifier: string,
  fromDir = workspaceBundledModuleFromDir(),
): string {
  const pkg = WORKSPACE_BUNDLED_MODULE_NAMES.find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  )
  if (!pkg) {
    throw new Error(`not a workspace-bundled module: ${specifier}`)
  }
  const resolved = path.resolve(Bun.resolveSync(specifier, fromDir))
  const repoRootAbs = path.resolve(dir, "../..")
  if (resolved !== repoRootAbs && !resolved.startsWith(repoRootAbs + path.sep)) {
    throw new Error(
      `${specifier} resolved outside the repo (${resolved}). Home node_modules must not shadow workspace ${pkg}.`,
    )
  }
  return resolved
}

function createWorkspaceBundledModulePlugin(): BunPlugin {
  return {
    name: "spinosa-workspace-bundled-modules",
    setup(build) {
      build.onResolve({ filter: /^(unzipper|markitdown-ts)(\/|$)/ }, (args) => ({
        path: resolveWorkspaceBundledModule(args.path),
      }))
    },
  }
}

import os from "node:os"
const builderHome = os.homedir().replaceAll("\\", "/").replace(/\/$/, "")
const builderHomeWin = builderHome.replaceAll("/", "\\")
const repoRoot = path.resolve(__dirname, "../..").replaceAll("\\", "/")
// Report-only scan prefixes. Generic builder/runner paths are NOT secrets and
// must never trigger a binary rewrite: mutating opaque native Mach-O payloads
// (OpenTUI, FFF, watcher, node-pty, canvas) corrupts their embedded signatures
// and macOS kills the host on dlopen (v1.1.0-beta.18/beta.19 darwin outage).
// This list exists only to report what builder strings remain in the output.
const EMBEDDED_BUILD_PATH_PREFIXES = [
  // Rust dependency metadata can retain the Windows cache path from the
  // cross-build image. Known path, reported without masking arbitrary user
  // paths (broad C:\\Users replacement corrupts binaries).
  Buffer.from(
    "C:\\Users\\silvi\\.cargo\\registry\\src\\index.crates.io-1949cf8c6b5b557f",
  ),
  // Repo root first (longer) so "/Users/.../spinosa-main" reports as repo path.
  ...(repoRoot && repoRoot !== builderHome ? [Buffer.from(repoRoot)] : []),
  ...(builderHome ? [Buffer.from(builderHome)] : []),
  ...(builderHomeWin && builderHomeWin !== builderHome ? [Buffer.from(builderHomeWin)] : []),
] as const

/** Byte range of pristine embedded file data inside the compiled binary. */
export interface EmbeddedSpan {
  start: number
  end: number
}

/**
 * Locate pristine embedded file bytes (e.g. a staged `.node` native) inside
 * the compiled binary. Bun may embed the same file asset more than once, so
 * every fullverbatim occurrence is returned. Slices are verified with a full
 * byte compare — fail closed when no complete copy is found, so packaging
 * problems surface here instead of as a corrupt native at runtime.
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
  throw new Error("embedded native span not locatable — refusing to proceed (fail closed)")
}

export function spanIntersects(match: number, end: number, spans: readonly EmbeddedSpan[]): boolean {
  return spans.some((span) => match < span.end && end > span.start)
}

export function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex")
}

/**
 * Fail closed when embedded bytes differ from pristine. With byte scrubbing
 * removed, this stays as a packaging-integrity probe for the canvas embed.
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
      `embedded ${label} changed after packaging (bytes ${span.start}..${span.end}): expected ${expectedHash}, got ${actual}`,
    )
  }
}

/**
 * Report-only scan for builder path strings left in the compiled binary.
 * Generic runner/checkout paths are not secrets — this never mutates the
 * binary. Returns the match count for logging. Byte-level rewriting of the
 * whole binary is forbidden: it corrupts embedded native Mach-O payloads
 * (OpenTUI, FFF) that only canvas-span protection used to spare, and macOS
 * code-signing enforcement kills the host on dlopen (beta.18/beta.19).
 */
export function scanEmbeddedBuildPaths(binaryPath: string): number {
  const bytes = fs.readFileSync(binaryPath)
  let matches = 0
  for (const prefix of EMBEDDED_BUILD_PATH_PREFIXES) {
    if (prefix.length === 0) continue
    let offset = 0
    while (true) {
      const match = bytes.indexOf(prefix, offset)
      if (match < 0) break
      matches++
      if (matches <= 5) {
        console.log(`embedded build path: ${prefix.toString()} at byte ${match} (report-only, binary untouched)`)
      }
      offset = match + 1
    }
  }
  return matches
}

/**
 * @deprecated Whole-binary rewriting is removed. Use scanEmbeddedBuildPaths
 * (report-only). Kept as a non-mutating alias so old callers/tests fail open
 * toward the safe behavior instead of corrupting the binary.
 */
export function scrubEmbeddedBuildPaths(binaryPath: string, _skipSpans: readonly EmbeddedSpan[] = []): number {
  return scanEmbeddedBuildPaths(binaryPath)
}

export function assertNoEmbeddedBuildPaths(binaryPath: string, skipSpans: readonly EmbeddedSpan[] = []): void {
  // Generic builder paths are report-only (see scanEmbeddedBuildPaths).
  // Personal markers are fail-closed in CI (release binaries must never
  // carry a maintainer username) but warn-only for local builds, where the
  // builder's own checkout path legitimately appears in stack-trace strings
  // and the binary is never rewritten to hide it (beta.18/beta.19 outage).
  const bytes = fs.readFileSync(binaryPath)
  // Personal markers that should never ship in CI binaries.
  // Verified-pristine spans are exempt: their bytes are hash-pinned vendored
  // input (assertEmbeddedSpanIntact), never rewritten.
  const personal = [Buffer.from("tommasoprinetti"), Buffer.from("thdxr")]
  const strict = Boolean(process.env.CI || process.env.GITHUB_ACTIONS)
  for (const p of personal) {
    let offset = 0
    while (true) {
      const off = bytes.indexOf(p, offset)
      if (off < 0) break
      if (!spanIntersects(off, off + p.byteLength, skipSpans)) {
        const message = `binary ${binaryPath} still contains personal marker ${p.toString()} at byte ${off}`
        if (strict) throw new Error(message)
        console.warn(`warning: ${message} (local build only — CI release gates fail closed)`)
        break
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
    createWorkspaceBundledModulePlugin(),
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

  // Multi-platform optionals for cross-target local builds. CI matrix jobs
  // build natively (target == host) from the frozen install and pass
  // --skip-install; the per-target canvas assert below fails closed when the
  // needed platform package is absent.
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

    // No OCR binaries ship — nothing to embed here.
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
        SPINOSA_WORKER_PATH: compiledTuiWorkerPath(bunfsRoot),
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
    // The binary is never rewritten after compile: embedded native Mach-O
    // payloads keep their pristine signatures (beta.18/beta.19 outage).
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

    const reportedPaths = scanEmbeddedBuildPaths(outfile)
    assertNoEmbeddedBuildPaths(outfile, canvasSpans)
    for (const span of canvasSpans) {
      assertEmbeddedSpanIntact(outfile, span, canvasHash, `canvas native ${canvasEmbed.name}`)
    }
    if (process.platform === "darwin" && item.os === "darwin") {
      const signed = await $`codesign --force --sign - ${outfile}`.nothrow()
      if (signed.exitCode !== 0) throw new Error(`failed to ad-hoc sign binary: ${outfile}`)
      const verified = await $`codesign --verify ${outfile}`.nothrow()
      if (verified.exitCode !== 0) throw new Error(`outer signature verification failed: ${outfile}`)
    }
    if (reportedPaths > 0) {
      console.log(`reported ${reportedPaths} embedded build path${reportedPaths === 1 ? "" : "s"} in ${assetName} (binary untouched)`)
    }

    if (
      options.smokeHost !== false &&
      item.os === process.platform &&
      item.arch === process.arch &&
      !item.abi
    ) {
      console.log(`Running smoke test: ${outfile} version + native-imports + tui-worker + parser-worker`)
      try {
        const versionOutput = await $`${outfile} version`.text()
        console.log(`Smoke test passed: ${versionOutput.trim()}`)
        if (!versionOutput.includes(options.version)) {
          throw new Error(`version smoke mismatch: expected ${options.version}, got ${versionOutput}`)
        }
        // version/doctor never dlopen OpenTUI/FFF — native-imports does.
        const nativeOutput = await $`${outfile} internal smoke native-imports --json`.text()
        console.log(`Native-imports smoke passed: ${nativeOutput.trim().slice(0, 400)}`)
        // Run tui-worker from a temp cwd. Kernel `src/cli/tui/worker.ts` exists
        // on disk here, so a cwd-relative worker path would false-pass.
        const smokeCwd = fs.mkdtempSync(path.join(os.tmpdir(), "spinosa-tui-worker-smoke-"))
        try {
          const tuiWorkerOutput = await $`${outfile} internal smoke tui-worker --json`.cwd(smokeCwd).text()
          console.log(`TUI-worker smoke passed: ${tuiWorkerOutput.trim().slice(0, 400)}`)
          const parserWorkerOutput = await $`${outfile} internal smoke parser-worker --json`.cwd(smokeCwd).text()
          console.log(`Parser-worker smoke passed: ${parserWorkerOutput.trim().slice(0, 400)}`)
        } finally {
          fs.rmSync(smokeCwd, { recursive: true, force: true })
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
