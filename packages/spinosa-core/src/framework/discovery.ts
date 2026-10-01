import { compareFrameworkVersions, parseInstallPinnedVersion } from "../utils/version"

import { accessSync, constants, existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import {
  isCompiledBinaryDistribution,
  readCompiledDistribution,
  compiledVersion,
  compiledTemplatePackId,
  compiledTemplatePackVersion,
  loadEmbeddedTemplatePack,
  resolveTemplateCacheRoot,
  readInstalledBinaryVersion,
  ensureEmbeddedTemplateCache,
  verifyEmbeddedTemplateCache,
} from "../distribution/bootstrap"
import { productHomeDir } from "@spinosa/kernel-core/util/user-dirs"
import { TEMPLATE_PACK_COMPLETE_MARKER, TEMPLATE_PACK_MANIFEST_NAME } from "../distribution/contract"
import { isTemplateCacheComplete } from "./template-pack"

// New layout (post restructure): workspace-template/.spinosa/workspace-files.tsv
const MARKER = path.join("workspace-template", ".spinosa", "workspace-files.tsv")
// Backward compat: old installations before workspace-template restructure
const LEGACY_MARKER = path.join(".spinosa", "workspace-files.tsv")
// Further-back compat: original framework/spinosa/framework-files.tsv
const ANCIENT_MARKER = path.join("framework", "spinosa", "framework-files.tsv")

export function hasFrameworkMarker(root: string): boolean {
  return existsSync(path.join(root, MARKER))
      || existsSync(path.join(root, LEGACY_MARKER))
      || existsSync(path.join(root, ANCIENT_MARKER))
}

function normalizeExistingRoot(root: string): string {
  try {
    return realpathSync(root)
  } catch {
    return root
  }
}

export function resolveTemplateRootFromFrameworkRoot(root: string): string | undefined {
  const nested = path.join(root, "workspace-template")
  if (existsSync(path.join(nested, ".spinosa", "workspace-files.tsv"))) return nested
  if (existsSync(path.join(root, ".spinosa", "workspace-files.tsv"))) return root
  return undefined
}

/** Legacy source-tree discovery — migration utilities only. Not used in binary mode. */
export function discoverInstalledFramework(versionsDir = path.join(productHomeDir(), "versions")): string | undefined {
  if (!existsSync(versionsDir)) return undefined
  let bestDir = ""
  let bestVersion = ""
  try {
    for (const verEntry of readdirSync(versionsDir, { withFileTypes: true })) {
      if (!verEntry.isDirectory()) continue
      const versionBase = path.join(versionsDir, verEntry.name)
      const ver = verEntry.name
      if (!/^\d/.test(ver)) continue

      if (hasFrameworkMarker(versionBase)) {
        if (!bestDir || (compareFrameworkVersions(ver, bestVersion) ?? -1) > 0) {
          bestVersion = ver
          bestDir = versionBase
        }
        continue
      }

      for (const fwEntry of readdirSync(versionBase, { withFileTypes: true })) {
        if (!fwEntry.isDirectory() || !fwEntry.name.startsWith("spinosa-framework-")) continue
        const fwPath = path.join(versionBase, fwEntry.name)
        if (!hasFrameworkMarker(fwPath)) continue
        const fwVer = fwEntry.name.replace("spinosa-framework-", "")
        if (!bestDir || (compareFrameworkVersions(fwVer, bestVersion) ?? -1) > 0) {
          bestVersion = fwVer
          bestDir = fwPath
        }
      }
    }
  } catch {
    // ignored — unreadable versions directory
  }
  return bestDir || undefined
}

function resolveBinaryTemplateRoot(): string | undefined {
  const env = process.env.SPINOSA_TEMPLATE_ROOT
  if (env && existsSync(path.join(env, ".spinosa", "workspace-files.tsv"))) {
    return normalizeExistingRoot(env)
  }

  const ensured = ensureEmbeddedTemplateCache()
  if (ensured.ok && existsSync(path.join(ensured.templateRoot, ".spinosa", "workspace-files.tsv"))) {
    return normalizeExistingRoot(ensured.templateRoot)
  }

  const cache = resolveTemplateCacheRoot()
  if (existsSync(path.join(cache, ".spinosa", "workspace-files.tsv"))) {
    return normalizeExistingRoot(cache)
  }
  return undefined
}

export function resolveFrameworkRoot(): string | undefined {
  // Binary mode: never let dormant ~/.spinosa/versions outrank the embedded pack.
  if (isCompiledBinaryDistribution()) {
    return resolveBinaryTemplateRoot()
  }

  const env = process.env.SPINOSA_TEMPLATE_ROOT ?? process.env.SPINOSA_FRAMEWORK_ROOT
  if (env && hasFrameworkMarker(env)) return normalizeExistingRoot(env)
  if (env && existsSync(path.join(env, ".spinosa", "workspace-files.tsv"))) {
    return normalizeExistingRoot(env)
  }

  const candidates: string[] = []
  // Dev / source installs may still use version trees.
  if (!process.env.SPINOSA_DISABLE_VERSION_TREE_DISCOVERY) {
    const installed = discoverInstalledFramework()
    if (installed) candidates.push(installed)
  }
  candidates.push(process.cwd())

  for (const candidate of candidates) {
    if (hasFrameworkMarker(candidate)) return normalizeExistingRoot(candidate)
  }
  return undefined
}

function markerDescription(root: string, marker: string) {
  const file = path.join(root, marker)
  try {
    const info = statSync(file)
    let readable = false
    try {
      accessSync(file, constants.R_OK)
      readable = true
    } catch {}
    return `${marker}=${info.isFile() ? "file" : info.isDirectory() ? "directory" : "other"}, readable=${readable}`
  } catch {
    return `${marker}=missing`
  }
}

function markerSummary(root: string) {
  const markerPaths = [MARKER, LEGACY_MARKER, ANCIENT_MARKER, path.join(".spinosa", "workspace-files.tsv")]
  const found = markerPaths.filter((marker) => existsSync(path.join(root, marker)))
  return found.length
    ? `markers: ${found.map((marker) => markerDescription(root, marker)).join("; ")}`
    : "no expected manifest marker"
}

function versionSearchDiagnostics(versionsDir: string) {
  if (!existsSync(versionsDir)) return `directory ${versionsDir} (missing)`
  const lines = [`directory ${versionsDir} (exists)`]
  try {
    const entries = readdirSync(versionsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    if (entries.length === 0) lines.push("entries: <none>")
    for (const entry of entries) {
      const versionBase = path.join(versionsDir, entry.name)
      if (!entry.isDirectory()) {
        lines.push(`entry ${entry.name}: skipped (not a directory)`)
        continue
      }
      if (!/^\d/.test(entry.name)) {
        lines.push(`entry ${entry.name}: skipped (not version-shaped)`)
        continue
      }
      lines.push(`version ${entry.name}: ${markerSummary(versionBase)}`)
      try {
        const children = readdirSync(versionBase, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
        for (const child of children) {
          if (!child.isDirectory() || !child.name.startsWith("spinosa-framework-")) continue
          lines.push(`candidate ${path.join(entry.name, child.name)}: ${markerSummary(path.join(versionBase, child.name))}`)
        }
      } catch (error) {
        lines.push(`candidate read ${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } catch (error) {
    lines.push(`read error: ${error instanceof Error ? error.message : String(error)}`)
  }
  return lines.join("; ")
}

function cacheDiagnostics(cacheRoot: string, expectedPackId: string, home: string) {
  const markerPath = path.join(cacheRoot, ".spinosa", TEMPLATE_PACK_COMPLETE_MARKER)
  const manifestPath = path.join(cacheRoot, ".spinosa", TEMPLATE_PACK_MANIFEST_NAME)
  let manifest = "missing"
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as { version?: unknown; packId?: unknown; files?: unknown }
      manifest = `version=${String(parsed.version ?? "<unknown>")}, packId=${String(parsed.packId ?? "<unknown>")}, files=${Array.isArray(parsed.files) ? parsed.files.length : "<unknown>"}`
    } catch (error) {
      manifest = `unreadable (${error instanceof Error ? error.message : String(error)})`
    }
  }
  const complete = isTemplateCacheComplete(cacheRoot, expectedPackId || undefined)
  const verification = verifyEmbeddedTemplateCache({ home })
  const verificationText = verification.ok ? "ok" : verification.error ?? "failed"
  return `${cacheRoot} (${markerSummary(cacheRoot)}; expectedPackId=${expectedPackId || "<none>"}; completionMarker=${existsSync(markerPath) ? "present" : "missing"}; manifest=${manifest}; complete=${complete}; verification=${verificationText})`
}

function configuredValue(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]
  if (value === undefined) return `${name}: <unset>`
  if (!value.trim()) return `${name}: <empty>`
  return `${name}: ${value}`
}

function diagnosticValue(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]
  if (value === undefined) return "<unset>"
  if (!value.trim()) return "<empty>"
  return value
}

export function frameworkRootFailureDiagnostics(input?: { cwd?: string; env?: NodeJS.ProcessEnv }): string {
  const env = input?.env ?? process.env
  const cwd = path.resolve(input?.cwd ?? process.cwd())
  const markerPaths = [MARKER, LEGACY_MARKER, ANCIENT_MARKER, path.join(".spinosa", "workspace-files.tsv")]
  const binary = isCompiledBinaryDistribution()
  const productHome = productHomeDir({ env })
  const cacheRoot = resolveTemplateCacheRoot(productHome, compiledTemplatePackVersion(), compiledTemplatePackId())
  const lines = [
    `Framework discovery mode: ${binary ? "compiled binary" : "source/dev"}`,
    `Distribution: ${readCompiledDistribution()}`,
    `Desktop packaged: ${env.SPINOSA_DESKTOP_PACKAGED ?? "<unset>"}; launchID=${env.SPINOSA_DESKTOP_LAUNCH_ID ?? "<unset>"}`,
    `Development framework search: ${diagnosticValue(env, "SPINOSA_DESKTOP_DEVELOPMENT_ROOT")}`,
    `Process: execPath=${process.execPath}; argv=${process.argv.join(" ")}`,
    `Working directory: ${cwd} (${markerSummary(cwd)})`,
    `PWD: ${env.PWD ?? "<unset>"}`,
    `App path: ${diagnosticValue(env, "SPINOSA_DESKTOP_APP_PATH")}`,
    `Resources path: ${diagnosticValue(env, "SPINOSA_DESKTOP_RESOURCES_PATH")}`,
    `Sidecar script: ${diagnosticValue(env, "SPINOSA_DESKTOP_SIDECAR_SCRIPT")}`,
    configuredValue(env, "SPINOSA_TEMPLATE_ROOT") + ` (${env.SPINOSA_TEMPLATE_ROOT ? markerSummary(env.SPINOSA_TEMPLATE_ROOT) : "not configured"})`,
    configuredValue(env, "SPINOSA_FRAMEWORK_ROOT") + ` (${env.SPINOSA_FRAMEWORK_ROOT ? markerSummary(env.SPINOSA_FRAMEWORK_ROOT) : "not configured"})`,
    configuredValue(env, "SPINOSA_HOME") + ` (resolved product home: ${productHome})`,
    configuredValue(env, "XDG_STATE_HOME"),
  ]

  if (binary) {
    lines.push(`Embedded template pack: ${loadEmbeddedTemplatePack() ? "registered" : "not registered"}`)
  } else {
    const versionsDir = path.join(productHome, "versions")
    const disabled = Boolean(env.SPINOSA_DISABLE_VERSION_TREE_DISCOVERY)
    const selected = disabled ? undefined : discoverInstalledFramework(versionsDir)
    lines.push(
      `Installed version search: ${disabled ? "disabled by SPINOSA_DISABLE_VERSION_TREE_DISCOVERY" : "enabled"}; `
      + `${versionSearchDiagnostics(versionsDir)}; selected ${selected ?? "<none>"}`,
    )
  }
  lines.push(`Template cache: ${cacheDiagnostics(cacheRoot, compiledTemplatePackId(), productHome)}`)
  lines.push(`Expected markers: ${markerPaths.join(" | ")}`)
  return lines.join("\n")
}

export function resolveFrameworkBin(): string | undefined {
  const root = resolveFrameworkRoot()
  if (!root) return undefined
  const templateRoot = resolveTemplateRootFromFrameworkRoot(root) ?? root
  const bin = path.join(templateRoot, ".bin", "spinosa")
  return existsSync(bin) ? bin : undefined
}

export async function readFrameworkFile(relativePath: string): Promise<string | undefined> {
  const root = resolveFrameworkRoot()
  if (!root) return undefined
  const directFile = Bun.file(path.join(root, relativePath))
  if (await directFile.exists()) return directFile.text()

  const templateRoot = resolveTemplateRootFromFrameworkRoot(root)
  if (!templateRoot) return undefined
  const templateFile = Bun.file(path.join(templateRoot, relativePath))
  if (!(await templateFile.exists())) return undefined
  return templateFile.text()
}

export function readFrameworkVersionFromRoot(frameworkRoot: string | undefined): string {
  if (isCompiledBinaryDistribution()) {
    const compiled = compiledVersion()
    if (compiled && compiled !== "dev") return compiled
    const installed = readInstalledBinaryVersion()
    if (installed) return installed
  }

  if (!frameworkRoot) return "dev"
  try {
    const metadataPath = path.join(frameworkRoot, "metadata", "version")
    if (existsSync(metadataPath)) {
      const version = readFileSync(metadataPath, "utf-8").trim()
      if (version) return version
    }

    const packagePath = path.join(frameworkRoot, "package.json")
    if (existsSync(packagePath)) {
      const parsed = JSON.parse(readFileSync(packagePath, "utf-8")) as { version?: unknown }
      if (typeof parsed.version === "string" && parsed.version.trim()) return parsed.version.trim()
    }

    const installerPath = path.join(frameworkRoot, "install.sh")
    if (existsSync(installerPath)) {
      const pinned = parseInstallPinnedVersion(readFileSync(installerPath, "utf-8"))
      if (pinned && pinned !== "__VERSION__") return pinned
    }

    const packMeta = path.join(frameworkRoot, ".spinosa", "template-pack.json")
    if (existsSync(packMeta)) {
      const parsed = JSON.parse(readFileSync(packMeta, "utf-8")) as { version?: string }
      if (parsed.version?.trim()) return parsed.version.trim()
    }

    const directoryVersion = path.basename(frameworkRoot)
    if (/^\d+\.\d+\.\d+(?:-.+)?$/.test(directoryVersion) && hasFrameworkMarker(frameworkRoot)) {
      return directoryVersion
    }
  } catch {
    return "dev"
  }
  return "dev"
}

export function installedReleaseVersion(frameworkRoot: string | undefined): string {
  if (isCompiledBinaryDistribution()) {
    const compiled = compiledVersion()
    if (compiled && compiled !== "dev" && compiled !== "local") return compiled
    const installed = readInstalledBinaryVersion()
    if (installed) return installed
  }
  const version = readFrameworkVersionFromRoot(frameworkRoot)
  return version === "dev" ? "" : version
}
