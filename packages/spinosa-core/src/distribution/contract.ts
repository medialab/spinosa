/**
 * Canonical binary-distribution contract shared by release, installer tests,
 * and runtime. Do not invent parallel asset-name mappings elsewhere.
 *
 * Design doc: docs/release/binary-distribution-contract.md
 */

import { existsSync, readdirSync } from "node:fs"

export const PRODUCT_BINARY_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
] as const

export type ProductBinaryTarget = (typeof PRODUCT_BINARY_TARGETS)[number]

export const PRODUCT_DISTRIBUTION = "binary" as const
export type ProductDistribution = typeof PRODUCT_DISTRIBUTION | "source" | "dev"

export const TEMPLATE_PACK_MANIFEST_NAME = "template-pack.json"
export const TEMPLATE_PACK_COMPLETE_MARKER = ".pack-complete"

export const INSTALL_METADATA_KEYS = {
  spinosa: "spinosa",
  lastInstalledVersion: "last_installed_version",
  distribution: "distribution",
  templatePackId: "template_pack_id",
  beta: "beta",
  legacySourceRuntime: "legacy_source_runtime",
  autoUpgrade: "auto_upgrade",
} as const

export const DEPRECATED_INSTALLER_FLAGS = ["--no-bundled-tools"] as const

export const HOME_LAYOUT = {
  binDir: "bin",
  binaryName: "spinosa",
  templatesDir: "templates",
  metadataDir: "metadata",
  configFile: "config.yaml",
  workspacesFile: "workspaces.json",
  logsDir: "logs",
  stagingDir: ".staging",
  legacyVersionsDir: "versions",
  legacyBun: "bin/bun",
  legacyLib: "lib",
  legacyEnv: "env.sh",
} as const

/** Binary uninstall removes these relative paths under SPINOSA_HOME. */
export const BINARY_UNINSTALL_RUNTIME_TARGETS = [
  "bin/spinosa",
  "templates",
  ".staging",
  "logs",
] as const

/** Paths that remain after binary uninstall (never auto-deleted). */
export const PRESERVED_AFTER_UNINSTALL = [
  "metadata",
  "versions",
] as const

export type BuildManifest = {
  product: "spinosa"
  version: string
  channel: "stable" | "beta"
  templatePackId: string
  assets: Record<ProductBinaryTarget, string>
}

export function productBinaryAssetName(target: ProductBinaryTarget): string {
  return `spinosa-${target}`
}

export function buildManifestAssets(): Record<ProductBinaryTarget, string> {
  return Object.fromEntries(
    PRODUCT_BINARY_TARGETS.map((target) => [target, productBinaryAssetName(target)]),
  ) as Record<ProductBinaryTarget, string>
}

export function expectedImmutableReleaseAssets(version: string): readonly string[] {
  void version
  return [
    "install.sh",
    ...PRODUCT_BINARY_TARGETS.map(productBinaryAssetName),
    "checksums.txt",
    "build-manifest.json",
  ]
}

export function expectedChannelReleaseAssets(): readonly string[] {
  return ["install.sh", "checksums.txt"]
}

export function isProductBinaryTarget(value: string): value is ProductBinaryTarget {
  return (PRODUCT_BINARY_TARGETS as readonly string[]).includes(value)
}

/** User-facing refusal shared with install.sh wording. */
export const MUSL_UNSUPPORTED_MESSAGE =
  "musl/Alpine Linux is unsupported; Spinosa needs glibc Linux (or macOS). Binary assets are glibc-only."

export type MuslLinuxHints = {
  /** Override process.platform (use "linux" / "darwin"). */
  platform?: string
  /** True when /etc/alpine-release exists. */
  alpineReleaseExists?: boolean
  /** True when /lib/ld-musl-* is present. */
  ldMuslPresent?: boolean
  /** Output of `ldd --version` (stderr+stdout). */
  lddVersionText?: string
  /** Directory to scan for ld-musl-* when auto-detecting (default /lib). */
  libDir?: string
}

function hasLdMuslBinary(libDir: string): boolean {
  try {
    return readdirSync(libDir).some((name) => name.startsWith("ld-musl-"))
  } catch {
    return false
  }
}

/**
 * Detect musl/Alpine Linux from explicit probe hints or live host checks.
 * Non-linux platforms always return false. Aligns with install.sh `is_musl_linux`.
 */
export function isMuslLinux(hints?: MuslLinuxHints): boolean {
  const platform = (hints?.platform ?? process.platform).toLowerCase()
  if (platform !== "linux") return false

  const hasExplicit =
    hints?.alpineReleaseExists !== undefined ||
    hints?.ldMuslPresent !== undefined ||
    hints?.lddVersionText !== undefined

  if (hasExplicit) {
    if (hints?.alpineReleaseExists) return true
    if (hints?.ldMuslPresent) return true
    if (hints?.lddVersionText && /musl/i.test(hints.lddVersionText)) return true
    return false
  }

  if (existsSync("/etc/alpine-release")) return true
  if (hasLdMuslBinary(hints?.libDir ?? "/lib")) return true
  return false
}

/**
 * Map host uname values to a canonical product target.
 * Rejects Windows / musl / unknown arches.
 *
 * Pass `libc: "musl"` to refuse explicitly. On a live musl host, linux targets
 * are refused unless `libc` is set to `gnu` / `glibc` (cross-resolve escape hatch).
 */
export function resolveProductBinaryTarget(input: {
  os: string
  arch: string
  libc?: string
}): ProductBinaryTarget {
  const osRaw = input.os.trim().toLowerCase()
  const archRaw = input.arch.trim().toLowerCase()

  let os: "darwin" | "linux"
  if (osRaw === "darwin" || osRaw === "macos" || osRaw === "osx") os = "darwin"
  else if (osRaw === "linux") os = "linux"
  else throw new Error(`Your OS "${input.os}" is not supported. Spinosa currently supports macOS (Apple Silicon & Intel) and Linux (glibc) on arm64 and x64 — Unsupported OS for binary distribution: ${input.os}`)

  let arch: "arm64" | "x64"
  if (archRaw === "arm64" || archRaw === "aarch64") arch = "arm64"
  else if (archRaw === "x64" || archRaw === "x86_64" || archRaw === "amd64") arch = "x64"
  else throw new Error(`Your CPU architecture "${input.arch}" is not supported. Spinosa currently supports arm64 and x64 on macOS and Linux (glibc) — Unsupported architecture for binary distribution: ${input.arch}`)

  if (os === "linux") {
    const libc = input.libc?.trim().toLowerCase()
    if (libc === "musl") {
      throw new Error(MUSL_UNSUPPORTED_MESSAGE)
    }
    const explicitGnu = libc === "gnu" || libc === "glibc"
    if (!explicitGnu && isMuslLinux()) {
      throw new Error(MUSL_UNSUPPORTED_MESSAGE)
    }
  }

  const target = `${os}-${arch}` as ProductBinaryTarget
  if (!isProductBinaryTarget(target)) {
    throw new Error(`Your platform "${target}" is not supported. Spinosa supports darwin-arm64, darwin-x64, linux-arm64, linux-x64 (glibc) — Unsupported product binary target: ${target}`)
  }
  return target
}

export function templateCacheDirName(version: string, packId: string): string {
  const short = packId.replace(/^sha256:/i, "").slice(0, 12)
  return `${version}-${short}`
}

export function templateCacheRelativePath(version: string, packId: string): string {
  return `${HOME_LAYOUT.templatesDir}/${templateCacheDirName(version, packId)}`
}
