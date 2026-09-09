import { homedir } from "node:os"
import path from "node:path"
import { mkdirSync } from "node:fs"
import { parseInstallPinnedVersion } from "../utils/version"
import { readYamlScalar, writeYamlConfig } from "../utils/yaml-config"
import { spinosaLogWarn } from "../utils/log"

export type ReleaseChannel = "stable" | "beta"

const SPINOSA_STABLE_INSTALL_URL =
  process.env.SPINOSA_STABLE_INSTALL_URL ??
  "https://github.com/medialab/spinosa/releases/download/stable/install.sh"

const SPINOSA_BETA_INSTALL_URL =
  process.env.SPINOSA_BETA_INSTALL_URL ??
  "https://github.com/medialab/spinosa/releases/download/beta/install.sh"


const SPINOSA_RELEASE_REPO =
  process.env.SPINOSA_RELEASE_REPO ?? "medialab/spinosa"
const FETCH_TIMEOUT_MS = 10_000

export function spinosaConfigFile(): string {
  const metaDir = process.env.SPINOSA_METADATA_DIR ??
    `${process.env.SPINOSA_HOME ?? `${homedir()}/.spinosa`}/metadata`
  return `${metaDir}/config.yaml`
}

export function spinosaBetaToggleChannel(value: string): ReleaseChannel {
  const clean = value.replace(/["']/g, "")
  switch (clean) {
    case "true":
    case "yes":
    case "on":
    case "1":
      return "beta"
    case "false":
    case "no":
    case "off":
    case "0":
      return "stable"
    default:
      throw new Error(`Invalid beta config value: ${value} (use true or false)`)
  }
}

export async function readConfigValue(configPath: string, key: string): Promise<string | undefined> {
  return readYamlScalar(configPath, key)
}

export async function spinosaReleaseChannel(): Promise<ReleaseChannel> {
  try {
    const envChannel = process.env.SPINOSA_RELEASE_CHANNEL
    if (envChannel) {
      return normalizeChannel(envChannel)
    }

    const configPath = spinosaConfigFile()
    const betaToggle = await readConfigValue(configPath, "beta")
    if (betaToggle) {
      return spinosaBetaToggleChannel(betaToggle)
    }

    // Legacy fallback — installers now write `beta: true|false` instead.
    const releaseChannel = await readConfigValue(configPath, "release_channel")
    return normalizeChannel(releaseChannel ?? "stable")
  } catch (error) {
    // A corrupt/invalid channel config must never block launching or the
    // upgrade check — degrade to the conservative stable channel.
    spinosaLogWarn("channels", `Invalid release channel configuration (${String(error)}); using stable`)
    return "stable"
  }
}

function normalizeChannel(ch: string): ReleaseChannel {
  const clean = ch.replace(/["']/g, "")
  switch (clean) {
    case "stable":
      return "stable"
    case "beta":
      return "beta"
    case "dev":
      return "beta"
    default:
      throw new Error(`Invalid release channel: ${clean} (use stable or beta)`)
  }
}

export async function setReleaseChannel(channel: ReleaseChannel): Promise<void> {
  const configPath = spinosaConfigFile()
  const configDir = path.dirname(configPath)
  const betaValue = channel === "beta"

  mkdirSync(configDir, { recursive: true })

  const file = Bun.file(configPath)
  if (!(await file.exists())) {
    await writeYamlConfig(
      configPath,
      (document) => {
        document.set("beta", betaValue)
      },
      "beta: false\n",
    )
    return
  }

  await writeYamlConfig(configPath, (document) => {
    document.set("beta", betaValue)
    document.delete("release_channel")
  })
}

/** `auto_upgrade: false` disables launch checks; anything else / missing = enabled. */
export async function readAutoUpgrade(): Promise<boolean> {
  try {
    const value = await readConfigValue(spinosaConfigFile(), "auto_upgrade")
    return value !== "false"
  } catch (error) {
    spinosaLogWarn("channels", `Could not read auto_upgrade setting (${String(error)}); defaulting to enabled`)
    return true
  }
}

export async function setAutoUpgrade(enabled: boolean): Promise<void> {
  const configPath = spinosaConfigFile()
  const configDir = path.dirname(configPath)

  mkdirSync(configDir, { recursive: true })

  const file = Bun.file(configPath)
  if (!(await file.exists())) {
    await writeYamlConfig(
      configPath,
      (document) => {
        document.set("auto_upgrade", enabled)
      },
      "auto_upgrade: true\n",
    )
    return
  }

  await writeYamlConfig(configPath, (document) => {
    document.set("auto_upgrade", enabled)
  })
}

export async function resolvePinnedVersionFromInstaller(url: string): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return undefined
    const script = await response.text()
    const version = parseInstallPinnedVersion(script)
    return version ?? undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

export async function resolveLatestStableVersion(): Promise<string | undefined> {
  return resolvePinnedVersionFromInstaller(SPINOSA_STABLE_INSTALL_URL)
}

export async function resolveLatestBetaVersion(): Promise<string | undefined> {
  return resolvePinnedVersionFromInstaller(SPINOSA_BETA_INSTALL_URL)
}

export async function resolveReleaseVersionForChannel(
  channel: ReleaseChannel,
): Promise<string | undefined> {
  switch (channel) {
    case "stable":
      return resolveLatestStableVersion()
    case "beta":
      return resolveLatestBetaVersion()
  }
}

export function installUrlForChannel(
  channel: ReleaseChannel,
  version?: string,
): string {
  if (version && version !== "latest") {
    return `https://github.com/${SPINOSA_RELEASE_REPO}/releases/download/v${version}/install.sh`
  }
  return channel === "stable" ? SPINOSA_STABLE_INSTALL_URL : SPINOSA_BETA_INSTALL_URL
}
