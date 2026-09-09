import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import * as readline from "node:readline"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { homedir, tmpdir as osTmpdir } from "node:os"
import path from "node:path"
import {
  type ReleaseChannel,
  installUrlForChannel,
  resolveReleaseVersionForChannel,
  setReleaseChannel,
  spinosaReleaseChannel,
} from "../system/channels"
import { discoverInstalledFramework, installedReleaseVersion, resolveFrameworkRoot } from "../framework/discovery"
import { compareFrameworkVersions, isDowngrade } from "../utils/version"
import { ensureGlobalMetadata, discoverRegisteredWorkspaces } from "../workspace/registry"
import { readWorkspaceMeta } from "../workspace/meta"
import { writeTextAtomic } from "../utils/fs"
import { spinosaLogInfo } from "../utils/log"

const FETCH_TIMEOUT_MS = 15_000
export interface UpgradeOptions {
  version?: string
  channel?: ReleaseChannel
  reinstall?: boolean
  allowDowngrade?: boolean
  yes?: boolean
  check?: boolean
  onPhase?: (phase: string, detail: string) => void
  suppressInstallOutput?: boolean
}

export interface UpgradeResult {
  success: boolean
  previousVersion?: string
  newVersion?: string
  workspaceUpgradesNeeded: string[]
  refusedReason?: string
  /** Operational failure detail (download, checksum, spawn, resolve). */
  error?: string
}

export interface AutoUpgradeResult {
  available: boolean
  currentVersion?: string
  latestVersion?: string
}

interface VersionCache {
  timestamp: number
  version: string
}

const VERSION_CACHE_TTL_SEC = 3600

export function verifyInstallerChecksum(installerScript: string, checksums: string): boolean {
  const expected = checksums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/, 2))
    .find((parts) => {
      if (parts.length !== 2) return false
      const raw = parts[1]!.trim().replace(/^\*+/, "")
      return path.basename(raw) === "install.sh"
    })?.[0]
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) return false
  const actual = createHash("sha256").update(installerScript).digest("hex")
  return actual.toLowerCase() === expected.toLowerCase()
}

const SPINOSA_RELEASE_REPO: string =
  process.env.SPINOSA_RELEASE_REPO ?? "medialab/spinosa"

function spinosaHome(): string {
  return process.env.SPINOSA_HOME ?? `${homedir()}/.spinosa`
}

function metadataDir(): string {
  return process.env.SPINOSA_METADATA_DIR ?? `${spinosaHome()}/metadata`
}

function versionCachePath(channel: string): string {
  return path.join(metadataDir(), `version_check_cache_${channel}`)
}

export function installedUpgradeVersion(version: string, home = spinosaHome()): string {
  // Binary installs: prefer active binary metadata / binary --version, not versions/<ver>.
  const binaryPath = path.join(home, "bin", "spinosa")
  if (existsSync(binaryPath)) {
    const fromMeta = (() => {
      try {
        const text = readFileSync(path.join(home, "metadata", "config.yaml"), "utf-8")
        return text.match(/^last_installed_version:\s*["']?([^\s"']+)/m)?.[1]?.trim() ?? ""
      } catch {
        return ""
      }
    })()
    if (fromMeta === version) return fromMeta

    const probe = spawnSync(binaryPath, ["version", "--json"], {
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    })
    if (probe.status === 0 && !probe.error) {
      try {
        const parsed = JSON.parse(probe.stdout) as { version?: string; data?: { version?: string } }
        const reported = parsed.version ?? parsed.data?.version ?? ""
        if (reported === version) return reported
      } catch {
        const match = probe.stdout.match(/spinosa\s+(\S+)/)
        if (match?.[1] === version) return match[1]
      }
    }
  }

  // Legacy source tree fallback (migration era only).
  return installedReleaseVersion(path.join(home, "versions", version))
}

export function readEffectiveInstalledVersion(): string {
  const home = spinosaHome()
  const binaryPath = path.join(home, "bin", "spinosa")
  if (existsSync(binaryPath)) {
    const fromMeta = (() => {
      try {
        const text = readFileSync(path.join(home, "metadata", "config.yaml"), "utf-8")
        return text.match(/^last_installed_version:\s*["']?([^\s"']+)/m)?.[1]?.trim() ?? ""
      } catch {
        return ""
      }
    })()
    if (fromMeta) return fromMeta

    const probe = spawnSync(binaryPath, ["version", "--json"], {
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    })
    if (probe.status === 0 && !probe.error) {
      try {
        const parsed = JSON.parse(probe.stdout) as { version?: string; data?: { version?: string } }
        const reported = parsed.version ?? parsed.data?.version ?? ""
        if (reported) return reported
      } catch {
        const match = probe.stdout.match(/spinosa\s+(\S+)/)
        if (match?.[1]) return match[1]
      }
    }
  }

  const fwRoot = resolveFrameworkRoot()
  const installedVersion = installedReleaseVersion(fwRoot)
  const effectiveInstalled =
    installedVersion === "dev" || !installedVersion ? "" : installedVersion

  if (!process.env.SPINOSA_DISABLE_VERSION_TREE_DISCOVERY) {
    const installedFwRoot = discoverInstalledFramework()
    if (installedFwRoot && installedFwRoot !== fwRoot) {
      const globalVersion = installedReleaseVersion(installedFwRoot)
      if (globalVersion) return globalVersion
    }
  }

  return effectiveInstalled
}


async function fetchReleaseNotes(version: string): Promise<string | undefined> {
  const apiUrl =
    version === "latest"
      ? `https://api.github.com/repos/${SPINOSA_RELEASE_REPO}/releases/latest`
      : `https://api.github.com/repos/${SPINOSA_RELEASE_REPO}/releases/tags/v${version}`
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return undefined
    const data = (await response.json()) as {
      tag_name?: string
      published_at?: string
      body?: string
    }
    const tag = data.tag_name ?? ""
    const published = (data.published_at ?? "").replace("T", " ").replace("Z", "")
    const body = data.body ?? ""
    return `${tag}|${published}|${body}`
  } catch {
    return undefined
  }
}

export function readVersionCache(
  channel: string,
): VersionCache | undefined {
  const cachePath = versionCachePath(channel)
  if (!existsSync(cachePath)) return undefined
  try {
    const lines = readFileSync(cachePath, "utf-8").split(/\r?\n/).filter((line) => line.length > 0)
    if (lines.length !== 2) return undefined
    return {
      timestamp: Number(lines[0]) || 0,
      version: lines[1]?.trim() ?? "",
    }
  } catch {
    return undefined
  }
}

export function writeVersionCache(
  channel: string,
  version: string,
): void {
  const cachePath = versionCachePath(channel)
  mkdirSync(path.dirname(cachePath), { recursive: true })
  const now = Math.floor(Date.now() / 1000)
  // Atomic write: a concurrent preflight reader must never observe a torn
  // (half-written) cache file.
  writeTextAtomic(cachePath, `${now}\n${version}\n`)
}

export async function upgradeFramework(
  options: UpgradeOptions,
): Promise<UpgradeResult> {
  const explicitChannel = !!options.channel
  spinosaLogInfo("upgrade", `channel=${options.channel ?? "default"} version=${options.version ?? "latest"} reinstall=${options.reinstall}`)
  const channel = options.channel ?? (await spinosaReleaseChannel())

  if (explicitChannel) {
    await setReleaseChannel(channel)
  }

  options.onPhase?.("channel", `Channel: ${channel}`)

  let resolvedVersion: string
  if (options.version && options.version !== "latest") {
    resolvedVersion = options.version
  } else {
    options.onPhase?.("resolve", `Resolving latest ${channel} version`)
    const latest = await resolveReleaseVersionForChannel(channel)
    if (!latest) {
      const hint =
        channel === "stable"
          ? "No stable release has been published yet — use --channel beta"
          : `No release found for channel ${channel}`
      const error = `Failed to resolve latest version for channel ${channel}. ${hint}`
      spinosaLogInfo("upgrade", error)
      return { success: false, workspaceUpgradesNeeded: [], error }
    }
    resolvedVersion = latest
  }

  options.onPhase?.("resolve", `Target version: v${resolvedVersion}`)

  const effectiveInstalled = readEffectiveInstalledVersion()

  if (!options.reinstall && effectiveInstalled && effectiveInstalled === resolvedVersion) {
    options.onPhase?.("current", `Already at v${resolvedVersion}`)
    return {
      success: true,
      previousVersion: effectiveInstalled,
      newVersion: effectiveInstalled,
      workspaceUpgradesNeeded: [],
    }
  }

  const direction = effectiveInstalled
    ? compareFrameworkVersions(effectiveInstalled, resolvedVersion)
    : 1

  if (isDowngrade(effectiveInstalled, resolvedVersion) && !options.reinstall && !options.allowDowngrade) {
    const reason = `Refusing to downgrade from v${effectiveInstalled} to v${resolvedVersion}. Use --reinstall or --allow-downgrade to proceed.`
    options.onPhase?.("refused", reason)
    return {
      success: false,
      refusedReason: reason,
      previousVersion: effectiveInstalled,
      newVersion: resolvedVersion,
      workspaceUpgradesNeeded: [],
    }
  }

  if (options.check) {
    const action = isDowngrade(effectiveInstalled, resolvedVersion) ? "downgrade" : "upgrade"
    options.onPhase?.("check", `Would ${action} to v${resolvedVersion}`)
    return {
      success: true,
      previousVersion: effectiveInstalled,
      newVersion: resolvedVersion,
      workspaceUpgradesNeeded: [],
    }
  }

  if (!options.yes) {
    options.onPhase?.("release_notes", "Fetching release notes")
    const releaseData = await fetchReleaseNotes(resolvedVersion)
    if (releaseData) {
      options.onPhase?.("release_notes", `Release: ${releaseData}`)
    } else {
      options.onPhase?.("release_notes", "Could not fetch release notes")
    }
    options.onPhase?.("confirm", "Awaiting confirmation")
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise<string>((resolve) => {
      rl.question(`Upgrade to v${resolvedVersion}? [Y/n] `, (answer) => {
        rl.close()
        resolve(answer.trim().toLowerCase())
      })
    })
    if (answer === "n" || answer === "no") {
      options.onPhase?.("confirm", "Upgrade cancelled")
      return {
        success: false,
        previousVersion: effectiveInstalled || undefined,
        workspaceUpgradesNeeded: [],
        error: "Upgrade cancelled by user",
      }
    }
  }

  options.onPhase?.("download", `Downloading installer v${resolvedVersion} (${channel})`)

  const installerUrl = installUrlForChannel(channel, options.version ?? "latest")

  let tmpdir: string
  try {
    tmpdir = mkdtempSync(path.join(osTmpdir(), "spinosa-upgrade-"))
  } catch (error) {
    return {
      success: false,
      previousVersion: effectiveInstalled || undefined,
      workspaceUpgradesNeeded: [],
      error: `Failed to create upgrade temp directory: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const installerPath = path.join(tmpdir, "install-spinosa.sh")

  let installerResponse: Response | undefined
  let checksumResponse: Response | undefined
  try {
    const checksumUrl = new URL("checksums.txt", installerUrl).toString()
    const results = await Promise.all([
      fetch(installerUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      fetch(checksumUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    ])
    installerResponse = results[0]
    checksumResponse = results[1]
    if (!installerResponse.ok || !checksumResponse.ok) {
      rmSync(tmpdir, { recursive: true, force: true })
      const instStatus = installerResponse ? String(installerResponse.status) : "no response"
      const sumStatus = checksumResponse ? String(checksumResponse.status) : "no response"
      const instUrl = installerUrl
      const sumUrl = checksumUrl
      return {
        success: false,
        previousVersion: effectiveInstalled || undefined,
        workspaceUpgradesNeeded: [],
        error: `Failed to download installer or checksums (HTTP ${instStatus}/${sumStatus}) from ${instUrl} (checksums ${sumUrl})`,
      }
    }
    const installerScript = await installerResponse.text()
    const checksums = await checksumResponse.text()
    if (!verifyInstallerChecksum(installerScript, checksums)) {
      rmSync(tmpdir, { recursive: true, force: true })
      return {
        success: false,
        previousVersion: effectiveInstalled || undefined,
        workspaceUpgradesNeeded: [],
        error: "Installer checksum verification failed",
      }
    }
    writeFileSync(installerPath, installerScript, { mode: 0o755 })
  } catch (err) {
    rmSync(tmpdir, { recursive: true, force: true })
    return {
      success: false,
      previousVersion: effectiveInstalled || undefined,
      workspaceUpgradesNeeded: [],
      error: `Failed to download installer: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  options.onPhase?.("install", "Running installer...")

  const upgradeArgs = ["--upgrade", "--version", resolvedVersion, "--no-launch", "--from-upgrade"]
  if (options.yes) upgradeArgs.push("--yes")
  if (options.reinstall) upgradeArgs.push("--reinstall")

  const installerResult = await runInstallerWithTimeout(
    installerPath,
    upgradeArgs,
    options,
  )
  if (installerResult.status !== 0) {
    rmSync(tmpdir, { recursive: true, force: true })
    const detail =
      installerResult.stderr.trim() ||
      installerResult.error?.message ||
      `installer exited with status ${installerResult.status ?? "unknown"}${installerResult.timedOut ? " (timed out)" : ""}`
    return {
      success: false,
      previousVersion: effectiveInstalled || undefined,
      workspaceUpgradesNeeded: [],
      error: `Installer failed: ${detail}`,
    }
  }

  const cacheDir = metadataDir()
  try {
    if (existsSync(cacheDir)) {
      for (const entry of readdirSync(cacheDir)) {
        if (entry.startsWith("version_check_cache")) {
          rmSync(path.join(cacheDir, entry), { force: true })
        }
      }
    }
  } catch { /* cleanup is best-effort */ }
  try { rmSync(tmpdir, { recursive: true, force: true }) } catch { /* cleanup is best-effort */ }

  // This process is still running from the previous release. Verify the newly
  // installed target directly instead of re-resolving the active framework.
  const postInstallVersion = installedUpgradeVersion(resolvedVersion)
  if (postInstallVersion !== resolvedVersion) {
    return {
      success: false,
      previousVersion: effectiveInstalled || undefined,
      newVersion: postInstallVersion || undefined,
      workspaceUpgradesNeeded: [],
      error: `Post-install version mismatch: expected v${resolvedVersion}, found ${postInstallVersion ? `v${postInstallVersion}` : "none"}`,
    }
  }

  options.onPhase?.("discover", "Checking workspaces for updates...")
  const workspaces: string[] = []
  try { workspaces.push(...(await discoverRegisteredWorkspaces())) } catch { /* workspace discovery is best-effort */ }
  const needsUpdate: string[] = []
  for (const ws of workspaces) {
    try {
      const meta = await readWorkspaceMeta(ws)
      if (
        meta &&
        meta.frameworkVersion &&
        meta.frameworkVersion !== "unknown" &&
        meta.frameworkVersion !== resolvedVersion
      ) {
        needsUpdate.push(ws)
      }
    } catch { /* individual workspace read failure is non-fatal */ }
  }

  return {
    success: true,
    previousVersion: effectiveInstalled || undefined,
    newVersion: resolvedVersion,
    workspaceUpgradesNeeded: needsUpdate,
  }
}

const INSTALLER_TIMEOUT_MS = 900_000

async function runInstallerWithTimeout(
  installerPath: string,
  upgradeArgs: string[],
  options: UpgradeOptions,
): Promise<{ status: number | null; stderr: string; error?: Error; timedOut?: boolean }> {
  return new Promise((resolve) => {
    const suppress = !!options.suppressInstallOutput
    let stderr = ""
    let timedOut = false
    const child = spawn("bash", [installerPath, ...upgradeArgs], {
      stdio: suppress ? ["ignore", "pipe", "pipe"] : "inherit",
      detached: true,
      env: { ...process.env, SPINOSA_UPGRADE: "1" },
    })

    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      timedOut = true
      try {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGTERM")
          } catch {
            child.kill("SIGTERM")
          }
        } else {
          child.kill("SIGTERM")
        }
      } catch {}
      const killTimer = setTimeout(() => {
        try {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL")
            } catch {
              child.kill("SIGKILL")
            }
          } else {
            child.kill("SIGKILL")
          }
        } catch {}
      }, 3000)
      // Ensure killTimer doesn't keep process alive
      if (killTimer && typeof (killTimer as unknown as { unref?: () => void }).unref === "function") {
        ;(killTimer as unknown as { unref: () => void }).unref!()
      }
    }, INSTALLER_TIMEOUT_MS)
    if (timer && typeof (timer as unknown as { unref?: () => void }).unref === "function") {
      ;(timer as unknown as { unref: () => void }).unref!()
    }

    if (suppress && child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8")
        stderr += text
        options.onPhase?.("install_output", text)
      })
    }
    if (suppress && child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        options.onPhase?.("install_output", chunk.toString("utf-8"))
      })
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer)
      resolve({ status: 1, stderr, error: err, timedOut })
    })
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      if (timedOut && stderr.trim().length === 0) {
        stderr = `Installer timed out after ${INSTALLER_TIMEOUT_MS / 1000}s`
      }
      resolve({ status: code, stderr, timedOut })
    })
  })
}
export async function checkUpgradeAvailable(): Promise<AutoUpgradeResult> {
  spinosaLogInfo("upgrade", "checkUpgradeAvailable start")
  if (process.env.SPINOSA_NO_UPGRADE_CHECK === "1") {
    return { available: false }
  }

  if (!process.stdin.isTTY) {
    return { available: false }
  }

  const fwRoot = resolveFrameworkRoot()
  // Use SPINOSA_TEMPLATE_ROOT when the dev tree has a product version in package.json.
  const installedVersion = installedReleaseVersion(fwRoot)
    || (process.env.SPINOSA_TEMPLATE_ROOT
      ? installedReleaseVersion(process.env.SPINOSA_TEMPLATE_ROOT)
      : "")
  if (!installedVersion) {
    return { available: false }
  }

  ensureGlobalMetadata()

  const channel = await spinosaReleaseChannel()
  const now = Math.floor(Date.now() / 1000)

  const cache = readVersionCache(channel)
  if (cache?.version && now - cache.timestamp < VERSION_CACHE_TTL_SEC) {
    const latestCmp = compareFrameworkVersions(cache.version, installedVersion)
    const available = latestCmp !== undefined && latestCmp > 0
    return {
      available,
      currentVersion: installedVersion,
      latestVersion: available ? cache.version : undefined,
    }
  }

  let latest: string | undefined
  try {
    latest = await resolveReleaseVersionForChannel(channel)
  } catch {
    return { available: false }
  }
  if (!latest) {
    return { available: false }
  }

  const latestCmp = compareFrameworkVersions(latest, installedVersion)
  const available = latestCmp !== undefined && latestCmp > 0

  writeVersionCache(channel, latest)

  return {
    available,
    currentVersion: installedVersion,
    latestVersion: available ? latest : undefined,
  }
}
