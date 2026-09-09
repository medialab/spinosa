import path from "node:path"
import { existsSync } from "node:fs"
import type { Argv, CommandModule } from "yargs"
import {
  readWorkspaceMeta,
  isSpinosaWorkspace,
  getFrameworkHealth,
} from "@spinosa/core/workspace/meta"
import {
  readFrameworkVersionFromRoot,
  resolveFrameworkRoot,
  resolveTemplateRootFromFrameworkRoot,
} from "@spinosa/core/framework/discovery"
import { inspectTemplatePackFreshness } from "@spinosa/core/framework/template-pack-freshness"
import { detectDocumentTools } from "@spinosa/core/scan/scanner"
import {
  isCompiledBinaryDistribution,
  compiledTemplatePackId,
  installedBinaryPath,
  resolveTemplateCacheRoot,
  verifyEmbeddedTemplateCache,
  readCompiledDistribution,
  readInstalledBinaryVersion,
} from "@spinosa/core/distribution/bootstrap"
import { isOcrPlatformSupported, ocrUnsupportedReason } from "@spinosa/core/tools/ocr-support"
import { moduleAvailable, ocrAvailable, pdfjsAvailable } from "@spinosa/core/tools/detection"
import { getFormat, log, emitResult, errorOut, type OutputFormat } from "../output"

interface DoctorArgs {
  workspace?: string
  json?: boolean
  quiet?: boolean
}

/** Static-specifier probes so Bun --compile can embed the modules (variable import() cannot). */
async function probePdfEngine(compiled: boolean): Promise<boolean> {
  if (compiled) return pdfjsAvailable()
  try {
    await import("pdfjs-dist/legacy/build/pdf.mjs")
    return true
  } catch {
    return false
  }
}

async function probeOcrEngine(compiled: boolean): Promise<{ ok: boolean; unsupported?: boolean; error?: string }> {
  const unsupported = ocrUnsupportedReason()
  if (unsupported) {
    return { ok: false, unsupported: true, error: unsupported }
  }
  if (compiled) return { ok: ocrAvailable() }
  try {
    await import("ppu-paddle-ocr")
    return { ok: true }
  } catch (err) {
    // Do not claim OCR available from a staged onnxruntime dylib/so alone —
    // that is not evidence the paddle module loads. Prefer honest "missing".
    const causes: string[] = []
    let cur: unknown = err
    for (let i = 0; i < 8 && cur; i++) {
      if (cur instanceof Error) {
        causes.push(`${cur.name}: ${cur.message}`)
        cur = (cur as Error & { cause?: unknown }).cause
      } else {
        causes.push(String(cur))
        break
      }
    }
    return { ok: false, error: causes.join(" <- ") }
  }
}

async function probeMarkitdown(): Promise<boolean> {
  // Do not `import("markitdown-ts")` from doctor: its optional dynamic deps
  // (youtube-transcript, unzipper) can resolve via polluted global node_modules
  // and fail the compile. Resolve-only is enough evidence the package is
  // embedded/present; never claim available without that evidence (binary mode
  // previously always returned true).
  // Spinosa fork is @spinosa/markitdown; keep markitdown-ts fallback.
  return (await moduleAvailable("@spinosa/markitdown", true)) || (await moduleAvailable("markitdown-ts", true))
}

async function probeCanvas(compiled: boolean): Promise<boolean> {
  if (compiled) return moduleAvailable("@napi-rs/canvas", true)
  try {
    await import("@napi-rs/canvas")
    return true
  } catch {
    return false
  }
}

export const DoctorCommand = {
  command: "doctor",
  describe: "Diagnose Spinosa framework and workspace health",
  builder: (yargs: Argv) =>
    yargs.option("workspace", { describe: "Workspace path to check", type: "string" }),
  handler: async (args: DoctorArgs) => {
    const fmt: OutputFormat = getFormat(args)
    const binaryMode = isCompiledBinaryDistribution()
    let healthy = true

    if (binaryMode) {
      const executable = process.execPath
      const installed = installedBinaryPath()
      const packId = compiledTemplatePackId()
      const cacheRoot = resolveTemplateCacheRoot()
      const verified = verifyEmbeddedTemplateCache()
      const metaVersion = readInstalledBinaryVersion()

      log(fmt, `Distribution: binary`)
      log(fmt, `Executable version: ${readFrameworkVersionFromRoot(undefined)}`)
      log(fmt, `Executable path: ${executable}`)
      log(fmt, `Installed binary: ${existsSync(installed) ? installed : "missing"}`)
      log(fmt, `Template pack: ${packId || "unknown"}`)
      log(fmt, `Template cache: ${verified.ok ? "valid" : `invalid (${verified.error})`}`)
      log(fmt, `Installation metadata: ${metaVersion ? `valid (${metaVersion})` : "missing"}`)
      if (!verified.ok) healthy = false
      if (!existsSync(cacheRoot) && !verified.ok) healthy = false

      const [pdf, ocr, markitdown, canvas] = await Promise.all([
      probePdfEngine(binaryMode),
      probeOcrEngine(binaryMode),
      probeMarkitdown(),
      probeCanvas(binaryMode),
      ])
      log(fmt, `Document converter: ${markitdown ? "available" : "missing"}`)
      log(fmt, `PDF engine: ${pdf ? "available" : "missing"}`)
      log(fmt, `Gateway: free tier idle 60-90s → use paid model for >100k batches (docs/reference/gateway-limits.md)`)
      log(fmt, `Channel: check ~/.spinosa/metadata/config.yaml (beta:true = beta channel, auto_upgrade:false = cached checks, network skipped when cache fresh)`)
      if (ocr.unsupported) {
        log(fmt, `OCR engine: unsupported`)
        if (ocr.error) log(fmt, `OCR: ${ocr.error}`)
      } else {
        log(fmt, `OCR engine: ${ocr.ok ? "available" : "missing"}`)
        if (!ocr.ok && ocr.error) log(fmt, `OCR probe error: ${ocr.error}`)
      }
      log(fmt, `Canvas: ${canvas ? "available" : "missing"}`)
      // OCR unsupported on linux-x64 is expected — do not fail closed / block activation.
      if (!pdf || !markitdown) healthy = false
      if (isOcrPlatformSupported() && !ocr.ok) healthy = false
    } else {
      const frameworkRoot = resolveFrameworkRoot()
      healthy = Boolean(frameworkRoot)
      log(fmt, `Distribution: ${readCompiledDistribution()}`)
      log(fmt, `Framework: ${frameworkRoot ?? "not found"}`)
      log(fmt, `Version: ${readFrameworkVersionFromRoot(frameworkRoot)}`)
      const tools = await detectDocumentTools()
      for (const [name, available] of Object.entries(tools)) {
        log(fmt, `${name}: ${available ? "ok" : "missing"}`)
        if (!available) healthy = false
      }
    }

    const requestedWorkspace = args.workspace
    const workspacePath = requestedWorkspace ? path.resolve(requestedWorkspace) : process.cwd()
    if (requestedWorkspace || isSpinosaWorkspace(workspacePath)) {
      const meta = await readWorkspaceMeta(workspacePath)
      if (!meta) {
        errorOut(fmt, `Workspace: invalid (${workspacePath})`)
        healthy = false
      } else {
        log(fmt, `Workspace: ${workspacePath}`)
        log(fmt, `Workspace version: ${meta.frameworkVersion}`)
        log(fmt, `Workspace registry: valid`)
        const frameworkRootForPack = resolveFrameworkRoot()
        const packFreshness = inspectTemplatePackFreshness({
          workspacePath,
          frameworkRoot: frameworkRootForPack,
          templateRoot: frameworkRootForPack
            ? resolveTemplateRootFromFrameworkRoot(frameworkRootForPack)
            : undefined,
          workspaceVersion: meta.frameworkVersion,
          bundledVersion: readFrameworkVersionFromRoot(frameworkRootForPack),
        })
        if (packFreshness.stale) {
          healthy = false
          log(fmt, `template pack: stale — ${packFreshness.message}`)
          for (const relative of [...packFreshness.stalePaths, ...packFreshness.missingPaths]) {
            log(fmt, `stale: ${relative}`)
          }
        } else {
          log(fmt, "template pack: current")
        }
        for (const check of getFrameworkHealth(workspacePath)) {
          if (!check.ok) healthy = false
          log(fmt, `${check.ok ? "ok" : "missing"}: ${check.label}`)
        }
      }
    }

    const frameworkRoot = resolveFrameworkRoot()
    emitResult(
      fmt,
      "doctor",
      {
        healthy,
        distribution: readCompiledDistribution(),
        frameworkRoot,
        version: readFrameworkVersionFromRoot(frameworkRoot),
        templatePackId: binaryMode ? compiledTemplatePackId() : undefined,
      },
      healthy ? "healthy" : "issues found",
    )
    if (!healthy) process.exitCode = 1
  },
} satisfies CommandModule<object, DoctorArgs>
