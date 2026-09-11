import path from "node:path"
import { existsSync } from "node:fs"
import { Effect } from "effect"
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
import { tesseractSource } from "@spinosa/core/distribution/tools"
import { moduleAvailable, ocrAvailable, pdfjsAvailable } from "@spinosa/core/tools/detection"
import { getFormat, log, emitResult, errorOut, type OutputFormat } from "../output"
import { effectCmd } from "../effect-cmd"

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

async function probeOcrEngine(compiled: boolean): Promise<{ ok: boolean; unsupported?: boolean; error?: string; source?: string }> {
  const unsupported = ocrUnsupportedReason()
  if (unsupported) {
    return { ok: false, unsupported: true, error: unsupported }
  }
  const ok = ocrAvailable()
  return { ok, source: ok ? tesseractSource() : undefined }
}

async function probeMarkitdown(): Promise<boolean> {
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

export const DoctorCommand = effectCmd<DoctorArgs, void>({
  command: "doctor",
  describe: "Diagnose Spinosa framework and workspace health",
  builder: (yargs) => yargs.option("workspace", { describe: "Workspace path to check", type: "string" }),
  instance: true,
  directory: (args) => ((args as DoctorArgs).workspace ? path.resolve((args as DoctorArgs).workspace!) : process.cwd()),
  handler: Effect.fn("Cli.doctor")(function* (args) {
    const fmt: OutputFormat = getFormat(args as Record<string, unknown>)
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

      const [pdf, ocr, markitdown, canvas] = yield* Effect.promise(() =>
        Promise.all([probePdfEngine(binaryMode), probeOcrEngine(binaryMode), probeMarkitdown(), probeCanvas(binaryMode)]),
      )
      log(fmt, `Document converter: ${markitdown ? "available" : "missing"}`)
      log(fmt, `PDF engine: ${pdf ? "available" : "missing"}`)
      log(fmt, `Gateway: free tier idle 60-90s → use paid model for >100k batches (docs/reference/gateway-limits.md)`)
      log(fmt, `Channel: check ~/.spinosa/metadata/config.yaml (beta:true = beta channel, auto_upgrade:false = cached checks, network skipped when cache fresh)`)
      if (ocr.unsupported) {
        log(fmt, `OCR engine: unsupported`)
        if (ocr.error) log(fmt, `OCR: ${ocr.error}`)
      } else {
        log(fmt, `OCR engine: ${ocr.ok ? "available" : "missing"}${ocr.ok && ocr.source ? ` (${ocr.source})` : ""}`)
        if (!ocr.ok && ocr.error) log(fmt, `OCR probe error: ${ocr.error}`)
      }
      log(fmt, `Canvas: ${canvas ? "available" : "missing"}`)
      if (!pdf || !markitdown) healthy = false
      if (isOcrPlatformSupported() && !ocr.ok) healthy = false
    } else {
      const frameworkRoot = resolveFrameworkRoot()
      healthy = Boolean(frameworkRoot)
      log(fmt, `Distribution: ${readCompiledDistribution()}`)
      log(fmt, `Framework: ${frameworkRoot ?? "not found"}`)
      log(fmt, `Version: ${readFrameworkVersionFromRoot(frameworkRoot)}`)
      const tools = yield* Effect.promise(() => detectDocumentTools())
      for (const [name, available] of Object.entries(tools)) {
        log(fmt, `${name}: ${available ? "ok" : "missing"}`)
        if (!available) healthy = false
      }
    }

    // Provider health — uses instance-scoped Provider + Config, falls back to empty when no instance
    try {
      const { Provider } = yield* Effect.promise(() => import("@/provider/provider"))
      const { Config } = yield* Effect.promise(() => import("@/config/config"))
      const cfg = yield* Config.Service.use((s) => s.get()).pipe(
        Effect.orElseSucceed(() => ({} as Record<string, unknown>)),
      )
      const providers = yield* Provider.Service.use((s) => s.list())
      const ids = Object.keys(providers)
      const disabled = (cfg as { disabled_providers?: string[] }).disabled_providers ?? []
      const enabled = (cfg as { enabled_providers?: string[] }).enabled_providers
      if (enabled) log(fmt, `Providers allowlist: ${enabled.join(", ")}`)
      if (disabled.length) log(fmt, `Providers disabled: ${disabled.join(", ")}`)
      if (ids.length === 0) {
        log(fmt, `Providers: none connected — run 'spinosa providers login' or set API key (e.g. OPENAI_API_KEY)`)
      } else {
        log(fmt, `Providers: ${ids.length} connected`)
        for (const [id, info] of Object.entries(providers)) {
          const count = Object.keys((info as { models: Record<string, unknown> }).models).length
          const src = (info as { source: string }).source
          log(fmt, `  ${id}: ${count} models [${src}]`)
        }
        // Check for providers with zero models (likely auth/config issue)
        const empty = Object.entries(providers)
          .filter(([, info]) => Object.keys((info as { models: Record<string, unknown> }).models).length === 0)
          .map(([id]) => id)
        if (empty.length) {
          log(fmt, `Providers with 0 models (check credentials): ${empty.join(", ")}`)
        }
      }
      // Auth hint when no providers but auth file has entries for disabled id
      if (ids.length === 0 && disabled.length) {
        log(fmt, `Hint: disabled providers hide auth — remove from disabled_providers to use them`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log(fmt, `Providers: check skipped (${msg.slice(0, 200)}) — run 'spinosa providers list' for details`)
    }

    const requestedWorkspace = (args as DoctorArgs).workspace
    const workspacePath = requestedWorkspace ? path.resolve(requestedWorkspace) : process.cwd()
    if (requestedWorkspace || isSpinosaWorkspace(workspacePath)) {
      const meta = yield* Effect.promise(() => readWorkspaceMeta(workspacePath).catch(() => undefined))
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
          templateRoot: frameworkRootForPack ? resolveTemplateRootFromFrameworkRoot(frameworkRootForPack) : undefined,
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
  }),
})
