import { accessSync, constants, existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

/**
 * Bundled OCR/document tools (tesseract, pdftoppm, tessdata).
 *
 * Layout under the Spinosa home so installs are self-contained:
 *   $SPINOSA_HOME/tools/<os>-<arch>/bin/{tesseract,pdftoppm}
 *   $SPINOSA_HOME/tools/<os>-<arch>/tessdata/{eng,ita,fra}.traineddata
 *   $SPINOSA_HOME/tools/TOOLS_MANIFEST.json
 *
 * Resolution order everywhere is bundled-first, host-second: a bundled
 * install is deterministic (survives brew upgrades/removals), while machines
 * with working host tools keep working with zero downloads.
 */

export const TOOLS_DIRNAME = "tools"
export const TOOLS_MANIFEST_FILENAME = "TOOLS_MANIFEST.json"
export const REQUIRED_TESS_LANGS = ["eng", "ita", "fra"] as const

export function spinosaHomeDir(home = process.env.SPINOSA_HOME): string {
  if (home) return home
  return path.join(homedir(), ".spinosa")
}

/** Canonical platform tag, mirroring install.sh map_platform. */
export function toolsPlatformTag(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : undefined
  const cpu = arch === "arm64" || arch === "aarch64" ? "arm64" : ["x64", "x86_64", "amd64"].includes(arch) ? "x64" : undefined
  if (!os || !cpu) return undefined
  return `${os}-${cpu}`
}

export function bundledToolsRoot(home = spinosaHomeDir(), platform = toolsPlatformTag()): string | undefined {
  const override = process.env.SPINOSA_TOOLS_DIR
  if (override) return override
  if (!platform) return undefined
  return path.join(home, TOOLS_DIRNAME, platform)
}

export function bundledToolsBinDir(home = spinosaHomeDir(), platform = toolsPlatformTag()): string | undefined {
  const root = bundledToolsRoot(home, platform)
  return root ? path.join(root, "bin") : undefined
}

function isExecutableFile(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Absolute path to a bundled tool binary, or undefined when not provisioned. */
export function bundledToolPath(name: "tesseract" | "pdftoppm", home = spinosaHomeDir()): string | undefined {
  const bin = bundledToolsBinDir(home)
  if (!bin) return undefined
  const candidate = path.join(bin, name + (process.platform === "win32" ? ".exe" : ""))
  return isExecutableFile(candidate) ? candidate : undefined
}

/** Bundled tessdata dir, only when ALL required languages are present. */
export function bundledTessdataDir(home = spinosaHomeDir()): string | undefined {
  const root = bundledToolsRoot(home)
  if (!root) return undefined
  const dir = path.join(root, "tessdata")
  const complete = REQUIRED_TESS_LANGS.every((lang) => {
    try {
      return statSync(path.join(dir, `${lang}.traineddata`)).isFile()
    } catch {
      return false
    }
  })
  return complete ? dir : undefined
}

let pathEnsuredFor: string | undefined

/**
 * Make bundled tools visible to PATH-based discovery (`Bun.which`,
 * child_process spawn) and point Tesseract at bundled tessdata.
 * Idempotent, microsecond-cheap after first call: safe on every startup
 * (dev and compiled binary alike). Never overrides an explicit
 * TESSDATA_PREFIX.
 */
export function ensureBundledToolsEnv(home = spinosaHomeDir()): { binDir?: string; tessdataDir?: string } {
  const binDir = bundledToolsBinDir(home)
  const usableBinDir = binDir && existsSync(binDir) ? binDir : undefined
  if (usableBinDir && pathEnsuredFor !== usableBinDir) {
    const current = process.env.PATH ?? ""
    const parts = current.split(path.delimiter)
    if (!parts.includes(usableBinDir)) {
      process.env.PATH = [usableBinDir, current].filter(Boolean).join(path.delimiter)
    }
    pathEnsuredFor = usableBinDir
  }
  const tessdataDir = bundledTessdataDir(home)
  if (tessdataDir && !process.env.TESSDATA_PREFIX) {
    process.env.TESSDATA_PREFIX = tessdataDir
  }
  return {
    binDir: binDir && existsSync(binDir) ? binDir : undefined,
    tessdataDir,
  }
}

/** Where the OCR engine resolves from — for logs/doctor/debugging. */
export function tesseractSource(home = spinosaHomeDir()): "bundled" | "host" | "none" {
  if (bundledToolPath("tesseract", home) && bundledToolPath("pdftoppm", home)) return "bundled"
  if (typeof Bun !== "undefined" && (Bun as unknown as { which?: (c: string) => string | null }).which) {
    const which = (Bun as unknown as { which: (c: string) => string | null }).which
    if (which("tesseract") && which("pdftoppm")) return "host"
    return "none"
  }
  return "none"
}
