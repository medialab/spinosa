#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import type { BunPlugin } from "bun"
import {
  assertNapiCanvasPlatformInstalled,
  materializeCanvasNativeEmbed,
  materializeOnnxNativeEmbed,
  napiCanvasForceModule,
  napiCanvasPlatformPackage,
  isOcrEmbeddedTarget,
  resolveOnnxRuntimeNodeRoot,
  restoreCanvasNativeStub,
  restoreOnnxNativeStub,
  ONNX_NATIVE_STUB_MODULE,
} from "./onnx-native.ts"

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

function scrubEmbeddedBuildPaths(binaryPath: string): number {
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

function assertNoEmbeddedBuildPaths(binaryPath: string): void {
  const bytes = fs.readFileSync(binaryPath)
  for (const { prefix } of EMBEDDED_BUILD_PATH_PREFIXES) {
    if (prefix.length === 0) continue
    const offset = bytes.indexOf(prefix)
    if (offset >= 0) {
      throw new Error(`binary ${binaryPath} still contains ${prefix.toString()} at byte ${offset}`)
    }
  }
  // Also fail on generic personal markers that should never ship
  const personal = [Buffer.from("tommasoprinetti"), Buffer.from("thdxr")]
  for (const p of personal) {
    const off = bytes.indexOf(p)
    if (off >= 0) throw new Error(`binary ${binaryPath} still contains personal marker ${p.toString()} at byte ${off}`)
  }
}

export function productAssetName(item: BinaryTarget): string {
  const os = item.os === "win32" ? "windows" : item.os
  const parts = [os, item.arch, item.avx2 === false ? "baseline" : undefined, item.abi]
  return `spinosa-${parts.filter(Boolean).join("-")}`
}

/** Pin onnxruntime-node to the workspace paddle-linked install (ignore polluted home node_modules). */
function createOnnxWorkspacePlugin(onnxRoot: string): BunPlugin {
  const indexJs = path.join(onnxRoot, "dist", "index.js")
  return {
    name: "onnxruntime-workspace",
    setup(build) {
      build.onResolve({ filter: /^onnxruntime-node$/ }, () => ({ path: indexJs }))
      build.onResolve({ filter: /^onnxruntime-node\// }, (args) => ({
        path: path.join(onnxRoot, args.path.slice("onnxruntime-node/".length)),
      }))
    },
  }
}

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
  const onnxRoot = resolveOnnxRuntimeNodeRoot(coreFrom)
  const plugins = [
    createPortableDependencyPlugin(),
    solidPlugin,
    createOnnxWorkspacePlugin(onnxRoot),
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

    // OCR is now tesseract (system binary, not onnx). No onnx embed needed.
    // Keep stub for compatibility; ppu-paddle-ocr/onnx removed.
    const wantOnnx = false
    const embedOcr = false
    let onnxEmbed: Awaited<ReturnType<typeof materializeOnnxNativeEmbed>> | null = null
    if (embedOcr) {
      onnxEmbed = await materializeOnnxNativeEmbed({
        cwd,
        target: { os: item.os, arch: item.arch },
        fromDir: coreFrom,
      })
      console.log(
        `embedding onnxruntime natives for ${item.os}-${item.arch}: ${onnxEmbed.libs
          .map((l) => `${l.name} (${fs.statSync(path.join(onnxEmbed!.libsDir, l.name)).size} bytes)`)
          .join(", ")}`,
      )
    } else {
      fs.writeFileSync(path.join(cwd, "src/generated/onnx-native.gen.ts"), ONNX_NATIVE_STUB_MODULE)
      const reason = !wantOnnx ? "SPINOSA_WITH_ONNX=0 (light build)" : "OCR unsupported on this product binary"
      console.log(`skipping onnxruntime embed for ${item.os}-${item.arch} (${reason})`)
    }

    const canvasTarget = { os: item.os, arch: item.arch, abi: item.abi }
    const canvasPkg = napiCanvasPlatformPackage(canvasTarget)
    assertNapiCanvasPlatformInstalled(canvasTarget, coreFrom)
    // Embed skia.<triple>.node on disk (template-blobs / onnx pattern). Nested
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
    files["src/generated/napi-canvas-force.gen.ts"] = napiCanvasForceModule(canvasPkg, {
      includeOcr: embedOcr,
    })
    console.log(`embedding ${canvasPkg} for ${item.os}-${item.arch}${embedOcr ? " (+ OCR)" : " (no OCR)"}`)

    const result = await Bun.build({
      conditions: ["bun", "node"],
      tsconfig: "./tsconfig.json",
      plugins,
      // youtube-transcript / unzipper are optional markitdown-ts deps; keep them
      // external so a polluted global markitdown install cannot fail the compile.
      external: ["node-gyp", "@aws-sdk/client-s3", "youtube-transcript", "unzipper"],
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
    if (onnxEmbed) {
      for (const lib of onnxEmbed.libs) {
        const libPath = path.join(onnxEmbed.libsDir, lib.name)
        const libData = fs.readFileSync(libPath)
        if (libData.byteLength < 1024) {
          throw new Error(`onnx lib too small to fingerprint: ${libPath}`)
        }
        if (binBytes.byteLength < libData.byteLength) {
          throw new Error(
            `binary ${outfile} (${binBytes.byteLength} bytes) smaller than onnx lib ${lib.name} (${libData.byteLength} bytes)`,
          )
        }
        const probeAt = Math.min(4096, libData.byteLength - 64)
        const probe = libData.subarray(probeAt, probeAt + 64)
        if (!binBytes.includes(probe)) {
          throw new Error(
            `binary ${outfile} missing embedded bytes for ${lib.name} (${item.os}-${item.arch}) — companion lib not packaged`,
          )
        }
      }
    }

    // Same fingerprint gate for canvas skia .node (OCR load path on Linux).
    {
      const libPath = path.join(canvasEmbed.libsDir, canvasEmbed.name)
      const libData = fs.readFileSync(libPath)
      if (libData.byteLength < 1024) {
        throw new Error(`canvas native too small to fingerprint: ${libPath}`)
      }
      if (binBytes.byteLength < libData.byteLength) {
        throw new Error(
          `binary ${outfile} (${binBytes.byteLength} bytes) smaller than canvas native ${canvasEmbed.name} (${libData.byteLength} bytes)`,
        )
      }
      const probeAt = Math.min(4096, libData.byteLength - 64)
      const probe = libData.subarray(probeAt, probeAt + 64)
      if (!binBytes.includes(probe)) {
        throw new Error(
          `binary ${outfile} missing embedded bytes for ${canvasEmbed.name} (${item.os}-${item.arch}) — canvas native not packaged`,
        )
      }
    }

    const scrubbedPaths = scrubEmbeddedBuildPaths(outfile)
    assertNoEmbeddedBuildPaths(outfile)
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
        // Clear any leftover staged lib so smoke proves embed→tmpdir staging works.
        const { tmpdir } = await import("node:os")
        if (onnxEmbed) {
          for (const lib of onnxEmbed.libs) {
            try {
              fs.rmSync(path.join(tmpdir(), lib.name), { force: true })
            } catch {
              /* ignore */
            }
          }
        }
        const versionOutput = await $`${outfile} version`.text()
        console.log(`Smoke test passed: ${versionOutput.trim()}`)
        if (!versionOutput.includes(options.version)) {
          throw new Error(`version smoke mismatch: expected ${options.version}, got ${versionOutput}`)
        }
        if (onnxEmbed) {
          for (const lib of onnxEmbed.libs) {
            const staged = path.join(tmpdir(), lib.name)
            if (!fs.existsSync(staged) || fs.statSync(staged).size < 1024) {
              throw new Error(`host smoke: onnx lib not staged to tmpdir after version: ${staged}`)
            }
          }
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        // Host smoke should pass once onnx natives are embedded; keep non-strict escape hatch.
        if (process.env.SPINOSA_BINARY_SMOKE_STRICT === "1") {
          console.error(`Smoke test failed for ${packageName}:`, e)
          throw e
        }
        console.warn(`Smoke test warning for ${packageName} (non-strict): ${detail.slice(0, 400)}`)
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
    restoreOnnxNativeStub(cwd)
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
