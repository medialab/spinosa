import { accessSync, constants, existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

/**
 * Bundled OCR tools (Spinosa-owned Tesseract + tessdata).
 *
 * Layout under the Spinosa home so installs are self-contained:
 *   $SPINOSA_HOME/tools/<os>-<arch>/bin/tesseract
 *   $SPINOSA_HOME/tools/<os>-<arch>/tessdata/{eng,ita,fra}.traineddata
 *   $SPINOSA_HOME/tools/TOOLS_MANIFEST.json
 *
 * Standalone resolution order (release contract):
 *   1. Spinosa bundled dependency
 *   2. Explicit developer override (SPINOSA_DEV_HOST_TOOLS=1, dev only)
 *   3. unavailable (fail closed — never silently use host tools, never
 *      modify the machine, never call Bun.which("tesseract") in production).
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
export function bundledToolPath(name: "tesseract", home = spinosaHomeDir()): string | undefined {
  const bin = bundledToolsBinDir(home)
  if (!bin) return undefined
  const candidate = path.join(bin, name + (process.platform === "win32" ? ".exe" : ""))
  return isExecutableFile(candidate) ? candidate : undefined
}

/** Legacy alias: pdftoppm is NOT a production dependency (pdf.js + Canvas
 * renders internally). Resolves only when a stale bundled copy exists, so
 * old installs keep working while new code never requires it. */
export function bundledLegacyToolPath(name: "pdftoppm", home = spinosaHomeDir()): string | undefined {
  const bin = bundledToolsBinDir(home)
  if (!bin) return undefined
  const candidate = path.join(bin, name)
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
export function tesseractSource(home = spinosaHomeDir()): "bundled" | "dev-host" | "none" {
  if (bundledToolPath("tesseract", home) && bundledTessdataDir(home)) return "bundled"
  if (process.env.SPINOSA_DEV_HOST_TOOLS === "1" && typeof Bun !== "undefined") {
    const which = (Bun as unknown as { which?: (c: string) => string | null }).which
    if (which?.("tesseract")) return "dev-host"
  }
  return "none"
}

/** Resolve the production Tesseract binary: bundled copy first, explicit
 * developer override second, otherwise throw (fail closed). Never falls back
 * to PATH silently. */
export function resolveTesseract(home = spinosaHomeDir()): string {
  const bundled = bundledToolPath("tesseract", home)
  if (bundled) return bundled
  if (process.env.SPINOSA_DEV_HOST_TOOLS === "1" && typeof Bun !== "undefined") {
    const which = (Bun as unknown as { which?: (c: string) => string | null }).which
    const host = which?.("tesseract")
    if (host) return host
  }
  throw new Error("Bundled Tesseract is unavailable (expected $SPINOSA_HOME/tools/<platform>/bin/tesseract with tessdata eng/ita/fra)")
}

/** Verify all mandatory bundled OCR assets exist. Returns missing entries
 * (empty = ready). Existence alone is checked here; content digests are
 * verified at install time (checksums.txt + per-file SHA256). */
export function verifyBundledTools(home = spinosaHomeDir()): string[] {
  const missing: string[] = []
  if (!bundledToolPath("tesseract", home)) missing.push("bin/tesseract")
  const tessdata = bundledTessdataDir(home)
  if (!tessdata) {
    for (const lang of REQUIRED_TESS_LANGS) missing.push(`tessdata/${lang}.traineddata`)
  }
  return missing
}
