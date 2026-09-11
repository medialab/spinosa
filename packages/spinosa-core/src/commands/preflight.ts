/**
 * Launch preflight for the Spinosa TUI.
 *
 * This module runs before the TUI starts. It checks for framework updates,
 * prints user-facing status lines, and can install an upgrade. After the
 * Spinosa upgrade check, it also offers to refresh workspaces whose template
 * pack (protocol / AGENTS / agents) is stale vs the current install.
 *
 * Returns "exit" after a successful launch-time upgrade so the launcher can
 * stop without auto-starting the TUI. Template-pack updates continue into the
 * TUI (update happens before launch, so no restart dance).
 */
import path from "node:path"
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { confirmPrompt } from "../utils/confirm"
import { spinosaLogInfo } from "../utils/log"
import { updateWorkspace, type UpdateResult } from "./update"
import {
  checkUpgradeAvailable,
  upgradeFramework,
  type AutoUpgradeResult,
  type UpgradeResult,
} from "./upgrade"
import {
  inspectTemplatePackFreshness,
  type TemplatePackFreshness,
} from "../framework/template-pack-freshness"
import {
  readFrameworkVersionFromRoot,
  resolveFrameworkRoot,
  resolveTemplateRootFromFrameworkRoot,
} from "../framework/discovery"
import { isSpinosaWorkspace, readWorkspaceMeta } from "../workspace/meta"
import { listRegisteredWorkspaces } from "../workspace/registry"

/** User-facing line printed before the remote version check. */
export const LAUNCH_STATUS_CHECKING = "Checking for updates..."

/** User-facing line printed when the installed version is current. */
export const LAUNCH_STATUS_NO_UPDATES = "No updates available"

/** User-facing line printed immediately before the TUI starts. */
export const LAUNCH_STATUS_LAUNCHING = "Launching TUI..."

/** User-facing line printed after a successful launch-time upgrade. */
export const LAUNCH_STATUS_UPGRADE_DONE = "Upgrade complete — run spinosa again to launch"

/** Minimum time each status line stays visible (ms). Cache-hit path skips this. */
export const MIN_STATUS_MS = 300

export type StaleTemplatePackWorkspace = {
  path: string
  name: string
  freshness: TemplatePackFreshness
}

export type UpdateWorkspaceOptions = {
  /** When true, overwrite replace_if_unmodified managed files (explicit pack refresh). */
  force?: boolean
}

export interface WorkspaceUpgradeOfferDeps {
  confirm(question: string, defaultYes?: boolean): Promise<boolean>
  /** Resolve template/framework root for the installed version (binary cache or legacy tree). */
  frameworkRoot(version: string): string
  updateWorkspace(
    workspacePath: string,
    frameworkRoot: string,
    options?: UpdateWorkspaceOptions,
  ): Promise<UpdateResult>
  out(message: string): void
}

export interface PreflightDependencies extends WorkspaceUpgradeOfferDeps {
  checkUpgradeAvailable(): Promise<AutoUpgradeResult>
  upgradeFramework(): Promise<UpgradeResult>
  /** Current install root used for pack freshness + update (optional override for tests). */
  currentFrameworkRoot?(): string | undefined
  /** Resolve workspaces to scan for stale packs (optional override for tests). */
  listPackCheckCandidates?(targetWorkspace?: string): Promise<string[]>
  /** Inspect pack freshness (optional override for tests). */
  inspectPack?(workspacePath: string, frameworkRoot: string): TemplatePackFreshness | Promise<TemplatePackFreshness>
  /** When false, skip interactive pack prompts (CI / no TTY). */
  canPrompt?(): boolean
  /** Delay helper (injected for tests to avoid real sleep). */
  sleep?(ms: number): Promise<void>
}

export interface LaunchPreflightOptions {
  /**
   * Workspace being opened (`spinosa /path`, `--project`, or cwd when it is a
   * Spinosa workspace). When set and valid, only that workspace is checked for
   * a stale pack; otherwise registered present/legacy workspaces are scanned.
   */
  targetWorkspace?: string
}

function defaultFrameworkRootForVersion(version: string): string {
  const home = process.env.SPINOSA_HOME ?? path.join(homedir(), ".spinosa")
  const envRoot = process.env.SPINOSA_TEMPLATE_ROOT
  if (envRoot) return envRoot

  const binary = path.join(home, "bin", "spinosa")
  if (existsSync(binary)) {
    try {
      const probe = spawnSync(binary, ["internal", "template", "ensure", "--json"], {
        encoding: "utf-8",
        env: process.env,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      })
      if (probe.status === 0) {
        const parsed = JSON.parse(probe.stdout) as { templateRoot?: string; ok?: boolean }
        if (parsed.ok && parsed.templateRoot) return parsed.templateRoot
      }
    } catch {
      /* fall through */
    }
  }

  return path.join(home, "versions", version)
}

function defaultCanPrompt(): boolean {
  if (process.env.SPINOSA_NO_UPGRADE_CHECK === "1") return false
  if (process.env.CI === "1" || process.env.CI === "true") return false
  if (process.argv.includes("--yes") || process.argv.includes("-y")) return false
  if (!process.stdin.isTTY) return false
  return true
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function ensureMinVisibleSince(start: number, minMs: number, deps: PreflightDependencies): Promise<void> {
  if (process.env.SPINOSA_DISABLE_PREFLIGHT_DELAY === "1") return
  const elapsed = Date.now() - start
  if (elapsed >= minMs) return
  const sleep = deps.sleep ?? defaultSleep
  await sleep(minMs - elapsed)
}

export async function defaultListPackCheckCandidates(targetWorkspace?: string): Promise<string[]> {
  if (targetWorkspace) {
    const resolved = path.resolve(targetWorkspace)
    if (isSpinosaWorkspace(resolved)) return [resolved]
  }

  try {
    const registered = await listRegisteredWorkspaces()
    return registered
      .filter((entry) => entry.presence === "present" || entry.presence === "legacy")
      .map((entry) => entry.path)
      .filter((workspacePath) => isSpinosaWorkspace(workspacePath))
  } catch {
    return []
  }
}

const defaults: PreflightDependencies = {
  checkUpgradeAvailable,
  upgradeFramework: () => upgradeFramework({ yes: true }),
  updateWorkspace: (workspacePath, frameworkRoot, options) =>
    updateWorkspace({ workspacePath, frameworkRoot, force: options?.force }),
  confirm: (question, defaultYes) => confirmPrompt(question, defaultYes),
  frameworkRoot: defaultFrameworkRootForVersion,
  currentFrameworkRoot: () => resolveFrameworkRoot() ?? process.env.SPINOSA_TEMPLATE_ROOT,
  listPackCheckCandidates: defaultListPackCheckCandidates,
  canPrompt: defaultCanPrompt,
  out: (message) => process.stdout.write(`${message}\n`),
  sleep: defaultSleep,
}

async function inspectPackFreshness(
  deps: PreflightDependencies,
  workspacePath: string,
  frameworkRoot: string,
): Promise<TemplatePackFreshness> {
  if (deps.inspectPack) return deps.inspectPack(workspacePath, frameworkRoot)
  const meta = await readWorkspaceMeta(workspacePath).catch(() => undefined)
  return inspectTemplatePackFreshness({
    workspacePath,
    frameworkRoot,
    templateRoot: resolveTemplateRootFromFrameworkRoot(frameworkRoot),
    workspaceVersion: meta?.frameworkVersion,
    bundledVersion: readFrameworkVersionFromRoot(frameworkRoot),
  })
}

/** Print the final launch line before the TUI worker starts. */
export function printLaunchingTui(out: (message: string) => void = defaults.out): void {
  out(LAUNCH_STATUS_LAUNCHING)
}

/** Same as printLaunchingTui but ensures the line stays visible at least MIN_STATUS_MS. */
export async function printLaunchingTuiWithDelay(
  out: (message: string) => void = defaults.out,
  sleep: (ms: number) => Promise<void> = defaults.sleep ?? defaultSleep,
): Promise<void> {
  out(LAUNCH_STATUS_LAUNCHING)
  if (process.env.SPINOSA_DISABLE_PREFLIGHT_DELAY === "1") return
  await sleep(MIN_STATUS_MS)
}

/**
 * After a successful CLI/framework upgrade, optionally update registered
 * workspaces still pinned to an older framework version.
 * Shared by launch preflight and `spinosa upgrade`.
 */
export async function offerWorkspaceUpgrades(
  workspaces: string[],
  frameworkVersion: string,
  deps: WorkspaceUpgradeOfferDeps,
): Promise<void> {
  if (workspaces.length === 0) return
  if (!(await deps.confirm(`\x1b[36m?\x1b[0m Upgrade ${workspaces.length} outdated workspace(s) now?`))) return

  const frameworkRoot = deps.frameworkRoot(frameworkVersion)
  let failed = 0
  for (const workspace of workspaces) {
    try {
      const result = await deps.updateWorkspace(workspace, frameworkRoot, { force: true })
      if (result.success && result.presence) {
        deps.out(`\x1b[36m●\x1b[0m Skipped ${path.basename(workspace) || workspace}: ${result.presence.replaceAll("_", " ").toUpperCase()}`)
      } else if (result.success) deps.out(`\x1b[32m●\x1b[0m Updated ${path.basename(workspace) || workspace}`)
      else {
        failed++
        deps.out(`\x1b[31m●\x1b[0m Could not update ${path.basename(workspace) || workspace}`)
      }
    } catch (error) {
      failed++
      deps.out(`\x1b[31m●\x1b[0m Could not update ${path.basename(workspace) || workspace}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failed > 0) deps.out(`\x1b[31m●\x1b[0m ${failed} workspace update(s) failed; run 'spinosa update <workspace>' to retry.`)
}

function formatStalePaths(freshness: TemplatePackFreshness): string {
  const paths = [...freshness.stalePaths, ...freshness.missingPaths]
  if (paths.length === 0) return "framework version behind"
  const shown = paths.slice(0, 4)
  const more = paths.length > shown.length ? ` (+${paths.length - shown.length} more)` : ""
  return shown.join(", ") + more
}

/**
 * Offer to refresh workspaces whose template pack is stale vs the current install.
 * On accept, updates in place and returns so the TUI can launch with fresh files.
 */
export async function offerStaleTemplatePackUpdates(
  deps: PreflightDependencies,
  options: LaunchPreflightOptions = {},
): Promise<void> {
  const canPrompt = deps.canPrompt ?? defaultCanPrompt
  if (!canPrompt()) {
    spinosaLogInfo("preflight", "template pack check skipped (non-interactive)")
    return
  }

  const frameworkRoot =
    (deps.currentFrameworkRoot ?? defaults.currentFrameworkRoot)?.() ??
    undefined
  if (!frameworkRoot) {
    spinosaLogInfo("preflight", "template pack check skipped (no framework root)")
    return
  }

  const listCandidates = deps.listPackCheckCandidates ?? defaultListPackCheckCandidates
  const candidates = await listCandidates(options.targetWorkspace)
  if (candidates.length === 0) return

  const stale: StaleTemplatePackWorkspace[] = []
  for (const workspacePath of candidates) {
    try {
      const meta = await readWorkspaceMeta(workspacePath).catch(() => undefined)
      const freshness = await inspectPackFreshness(deps, workspacePath, frameworkRoot)
      if (!freshness.refreshRecommended) continue
      stale.push({
        path: workspacePath,
        name: meta?.projectName || path.basename(workspacePath) || workspacePath,
        freshness,
      })
    } catch {
      /* individual workspace read failure is non-fatal */
    }
  }

  if (stale.length === 0) {
    spinosaLogInfo("preflight", "template packs current")
    return
  }

  deps.out(`\x1b[1m→\x1b[0m Workspace template pack update available for ${stale.length} workspace(s):`)
  for (const entry of stale) {
    deps.out(`\x1b[36m●\x1b[0m ${entry.name} — ${formatStalePaths(entry.freshness)}`)
  }
  deps.out("(updates protocol files, AGENTS.md, and agent skills)")

  if (!(await deps.confirm(`\x1b[36m?\x1b[0m Update ${stale.length} workspace template pack(s) now?`, true))) {
    deps.out("Continuing without updating — you can run Update workspace from Home later.")
    return
  }

  let failed = 0
  for (const entry of stale) {
    try {
      // Explicit Y means refresh the pack the user was shown as stale — force
      // replace_if_unmodified managed files so probes cannot stay forever-stale.
      const result = await deps.updateWorkspace(entry.path, frameworkRoot, { force: true })
      if (result.success && result.presence) {
        deps.out(`\x1b[36m●\x1b[0m Skipped ${entry.name}: ${result.presence.replaceAll("_", " ").toUpperCase()}`)
        continue
      }
      if (!result.success) {
        failed++
        deps.out(`\x1b[31m●\x1b[0m Could not update ${entry.name}${result.error ? `: ${result.error}` : ""}`)
        continue
      }

      const after = await inspectPackFreshness(deps, entry.path, frameworkRoot)
      if (after.refreshRecommended) {
        failed++
        const detail = formatStalePaths(after)
        deps.out(`\x1b[31m●\x1b[0m ${entry.name} still stale after update${detail ? `: ${detail}` : ""}`)
        spinosaLogInfo(
          "preflight",
          `template pack still stale after forced update: ${entry.path} (${detail || "version behind"})`,
        )
      } else {
        deps.out(`\x1b[32m●\x1b[0m Updated ${entry.name} — template pack current`)
        spinosaLogInfo("preflight", `template pack refreshed: ${entry.path}`)
      }
    } catch (error) {
      failed++
      deps.out(`\x1b[31m●\x1b[0m Could not update ${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failed > 0) deps.out(`\x1b[31m●\x1b[0m ${failed} workspace update(s) failed; run 'spinosa update <workspace> --force' to retry.`)
}

/**
 * Check for updates before the TUI opens.
 * Returns "exit" when an upgrade was installed and the launcher should stop.
 */
export async function runLaunchPreflight(
  deps?: PreflightDependencies | null,
  options: LaunchPreflightOptions = {},
): Promise<"continue" | "exit"> {
  const resolved = deps ?? defaults
  spinosaLogInfo("preflight", `preflight check started (pid=${process.pid})`)
  resolved.out(LAUNCH_STATUS_CHECKING)
  const tChecking = Date.now()

  const available = await resolved.checkUpgradeAvailable()
  const elapsedChecking = Date.now() - tChecking
  spinosaLogInfo("preflight", `upgrade check: available=${available.available} latest=${available.latestVersion ?? "none"} elapsed=${elapsedChecking}ms`)

  // Cache-hit (disk <150ms) skips MIN_STATUS delay — version cache TTL is beta:300 stable:3600
  const isCacheHit = elapsedChecking < 150
  if (!isCacheHit) {
    await ensureMinVisibleSince(tChecking, MIN_STATUS_MS, resolved)
  }

  if (!available.available || !available.latestVersion) {
    resolved.out(LAUNCH_STATUS_NO_UPDATES)
    if (!isCacheHit) {
      const tNoUpdates = Date.now()
      spinosaLogInfo("preflight", "no upgrade needed, continuing")
      await ensureMinVisibleSince(tNoUpdates, MIN_STATUS_MS, resolved)
    } else {
      spinosaLogInfo("preflight", "no upgrade needed (cached), continuing without delay")
    }
    await offerStaleTemplatePackUpdates(resolved, options)
    return "continue"
  }

  const current = available.currentVersion ? ` (current \x1b[32mv${available.currentVersion}\x1b[0m)` : ""
  if (!(await resolved.confirm(`\x1b[36m?\x1b[0m \x1b[1mSpinosa v${available.latestVersion}\x1b[0m is available${current}. Upgrade now?`, true))) {
    await offerStaleTemplatePackUpdates(resolved, options)
    return "continue"
  }

  const upgraded = await resolved.upgradeFramework()
  if (!upgraded.success || !upgraded.newVersion) {
    const detail = upgraded.error ? `: ${upgraded.error}` : ""
    throw new Error(`Spinosa upgrade failed${detail}. Run 'spinosa upgrade' for details.`)
  }

  await offerWorkspaceUpgrades(upgraded.workspaceUpgradesNeeded, upgraded.newVersion, resolved)

  resolved.out(LAUNCH_STATUS_UPGRADE_DONE)
  return "exit"
}
