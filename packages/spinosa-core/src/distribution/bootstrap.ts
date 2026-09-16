import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  HOME_LAYOUT,
  PRODUCT_DISTRIBUTION,
  templateCacheRelativePath,
  type ProductDistribution,
} from "../distribution/contract"
import {
  extractTemplatePackAtomic,
  isTemplateCacheComplete,
  verifyExtractedTemplatePack,
  type EmbeddedTemplatePack,
  type TemplatePackMeta,
} from "../framework/template-pack"

declare const SPINOSA_VERSION: string
declare const SPINOSA_DISTRIBUTION: string
declare const SPINOSA_TEMPLATE_PACK_ID: string
declare const SPINOSA_TEMPLATE_PACK_VERSION: string

export function spinosaHome(): string {
  return process.env.SPINOSA_HOME ?? path.join(homedir(), ".spinosa")
}

export function readCompiledDistribution(): ProductDistribution {
  return (typeof SPINOSA_DISTRIBUTION === "string" ? SPINOSA_DISTRIBUTION : "dev") as ProductDistribution
}

export function isCompiledBinaryDistribution(): boolean {
  return readCompiledDistribution() === PRODUCT_DISTRIBUTION
}

export function compiledVersion(): string {
  return typeof SPINOSA_VERSION === "string" ? SPINOSA_VERSION : "dev"
}

export function compiledTemplatePackId(): string {
  return typeof SPINOSA_TEMPLATE_PACK_ID === "string" ? SPINOSA_TEMPLATE_PACK_ID : ""
}

export function compiledTemplatePackVersion(): string {
  return typeof SPINOSA_TEMPLATE_PACK_VERSION === "string"
    ? SPINOSA_TEMPLATE_PACK_VERSION
    : compiledVersion()
}

export function resolveTemplateCacheRoot(
  home = spinosaHome(),
  version = compiledTemplatePackVersion(),
  packId = compiledTemplatePackId(),
): string {
  if (!packId) return path.join(home, HOME_LAYOUT.templatesDir, version)
  return path.join(home, templateCacheRelativePath(version, packId))
}

let embeddedPackLoader: (() => EmbeddedTemplatePack | undefined) | undefined

/** Kernel registers the generated embed pack at startup. */
export function registerEmbeddedTemplatePack(loader: () => EmbeddedTemplatePack | undefined): void {
  embeddedPackLoader = loader
}

export function loadEmbeddedTemplatePack(): EmbeddedTemplatePack | undefined {
  return embeddedPackLoader?.()
}

export type TemplateEnsureResult = {
  ok: boolean
  version: string
  templatePackId: string
  templateRoot: string
  repaired?: boolean
  error?: string
}

export function ensureEmbeddedTemplateCache(options?: {
  home?: string
  pack?: EmbeddedTemplatePack
  force?: boolean
}): TemplateEnsureResult {
  const version = compiledTemplatePackVersion()
  const packId = compiledTemplatePackId()
  const home = options?.home ?? spinosaHome()
  const templateRoot = resolveTemplateCacheRoot(home, version, packId)
  const pack = options?.pack ?? loadEmbeddedTemplatePack()

  if (!isCompiledBinaryDistribution() && !pack) {
    return {
      ok: false,
      version,
      templatePackId: packId,
      templateRoot,
      error: "not a compiled binary distribution and no pack provided",
    }
  }

  if (!options?.force && isTemplateCacheComplete(templateRoot, packId || undefined)) {
    return { ok: true, version, templatePackId: packId, templateRoot }
  }

  if (!pack) {
    return {
      ok: false,
      version,
      templatePackId: packId,
      templateRoot,
      error: "embedded template pack unavailable",
    }
  }

  try {
    mkdirSync(path.join(home, HOME_LAYOUT.templatesDir), { recursive: true })
  } catch (error) {
    return {
      ok: false,
      version: pack.version,
      templatePackId: pack.packId,
      templateRoot,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  const extracted = extractTemplatePackAtomic(pack, templateRoot)
  if (!extracted.ok) {
    return {
      ok: false,
      version: pack.version,
      templatePackId: pack.packId,
      templateRoot,
      error: extracted.error,
    }
  }

  process.env.SPINOSA_TEMPLATE_ROOT = extracted.templateRoot
  return {
    ok: true,
    version: pack.version,
    templatePackId: pack.packId,
    templateRoot: extracted.templateRoot,
    repaired: true,
  }
}

export function verifyEmbeddedTemplateCache(options?: {
  home?: string
  meta?: TemplatePackMeta
}): TemplateEnsureResult {
  const version = compiledTemplatePackVersion()
  const packId = compiledTemplatePackId()
  const home = options?.home ?? spinosaHome()
  const templateRoot = resolveTemplateCacheRoot(home, version, packId)
  const pack = loadEmbeddedTemplatePack()
  const meta =
    options?.meta ??
    (pack
      ? {
          version: pack.version,
          packId: pack.packId,
          files: pack.files.map((f) => ({ path: f.path, sha256: f.sha256, mode: f.mode })),
        }
      : undefined)

  if (!meta) {
    return {
      ok: false,
      version,
      templatePackId: packId,
      templateRoot,
      error: "no template pack metadata to verify",
    }
  }

  const verified = verifyExtractedTemplatePack(templateRoot, meta)
  if (!verified.ok) {
    return {
      ok: false,
      version: meta.version,
      templatePackId: meta.packId,
      templateRoot,
      error: verified.error,
    }
  }
  return {
    ok: true,
    version: meta.version,
    templatePackId: meta.packId,
    templateRoot,
  }
}

export function bootstrapBinaryRuntime(): TemplateEnsureResult | undefined {
  if (!isCompiledBinaryDistribution()) return undefined
  const result = ensureEmbeddedTemplateCache()
  if (result.ok) {
    process.env.SPINOSA_TEMPLATE_ROOT = result.templateRoot
  }
  return result
}

export function readInstalledBinaryVersion(home = spinosaHome()): string {
  const configPath = path.join(home, HOME_LAYOUT.metadataDir, HOME_LAYOUT.configFile)
  if (!existsSync(configPath)) return ""
  try {
    const text = readFileSync(configPath, "utf-8")
    const match = text.match(/^last_installed_version:\s*["']?([^\s"']+)/m)
    return match?.[1]?.trim() ?? ""
  } catch {
    return ""
  }
}

/**
 * Reason the install was flagged health-unverified (e.g. "timeout" when the
 * staged doctor gate never returned a verdict). Empty when verified.
 */
export function readDoctorUnverifiedReason(home = spinosaHome()): string {
  const configPath = path.join(home, HOME_LAYOUT.metadataDir, HOME_LAYOUT.configFile)
  if (!existsSync(configPath)) return ""
  try {
    const text = readFileSync(configPath, "utf-8")
    const match = text.match(/^doctor_unverified:\s*["']?([^\s"']+)/m)
    return match?.[1]?.trim() ?? ""
  } catch {
    return ""
  }
}

/**
 * Clear a stale `doctor_unverified` flag after a subsequent full doctor
 * passes healthy. Returns true when a flag was present and removed.
 * No-op (false) when the metadata file or flag is absent — never throws.
 */
export function clearDoctorUnverifiedReason(home = spinosaHome()): boolean {
  const configPath = path.join(home, HOME_LAYOUT.metadataDir, HOME_LAYOUT.configFile)
  if (!existsSync(configPath)) return false
  try {
    const text = readFileSync(configPath, "utf-8")
    if (!/^doctor_unverified:/m.test(text)) return false
    const next = text
      .split("\n")
      .filter((line) => !/^doctor_unverified:\s*/.test(line))
      .join("\n")
    writeFileSync(configPath, next)
    return true
  } catch {
    return false
  }
}

export function installedBinaryPath(home = spinosaHome()): string {
  return path.join(home, HOME_LAYOUT.binDir, HOME_LAYOUT.binaryName)
}
