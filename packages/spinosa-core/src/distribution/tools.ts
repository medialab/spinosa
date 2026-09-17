import path from "node:path"
import { productHomeDir } from "@spinosa/kernel-core/util/user-dirs"

/**
 * Legacy bundled-tools layout helpers.
 *
 * No OCR engine ships: nothing is provisioned under
 * $SPINOSA_HOME/tools/ anymore. These path helpers remain so the installer
 * removal manifest and layout code keep resolving the same locations.
 */

export const TOOLS_DIRNAME = "tools"
export const TOOLS_MANIFEST_FILENAME = "TOOLS_MANIFEST.json"

export function spinosaHomeDir(home = process.env.SPINOSA_HOME): string {
  if (home) return home
  return productHomeDir()
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

/** Verify all mandatory bundled assets exist — none required (no engine ships). */
export function verifyBundledTools(home = spinosaHomeDir()): string[] {
  void home
  return []
}
