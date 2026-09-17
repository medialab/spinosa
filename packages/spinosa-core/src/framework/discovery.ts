import { compareFrameworkVersions, parseInstallPinnedVersion } from "../utils/version"

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import path from "node:path"
import {
  isCompiledBinaryDistribution,
  compiledVersion,
  resolveTemplateCacheRoot,
  readInstalledBinaryVersion,
  ensureEmbeddedTemplateCache,
} from "../distribution/bootstrap"
import { productHomeDir } from "@spinosa/kernel-core/util/user-dirs"

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
export function discoverInstalledFramework(): string | undefined {
  const versionsDir = path.join(productHomeDir(), "versions")
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
