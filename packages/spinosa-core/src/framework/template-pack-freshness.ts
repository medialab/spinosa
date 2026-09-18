import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { compareFrameworkVersions, isLegacyDevWorkspaceVersion, normalizeFrameworkVersion } from "../utils/version"
import { readFrameworkVersionFromRoot, resolveTemplateRootFromFrameworkRoot } from "./discovery"

/** Protocol files that define startup/orchestration behavior. */
export const TEMPLATE_PACK_PROTOCOL_PROBES = [
  "startup-prompt.md",
  "AGENTS.md",
  ".agents/references/classification.md",
  ".agents/agents/spinosa-overseer.md",
  ".agents/skills/spinosa-overseer/SKILL.md",
] as const

export type TemplatePackProtocolProbe = (typeof TEMPLATE_PACK_PROTOCOL_PROBES)[number]

export type TemplatePackFreshness = {
  stale: boolean
  refreshRecommended: boolean
  versionBehind: boolean
  versionAhead: boolean
  protocolBehind: boolean
  workspaceVersion?: string
  bundledVersion?: string
  stalePaths: string[]
  missingPaths: string[]
  message: string
}

const STARTUP_METADATA_MARKERS = [
  "\n## Workspace Metadata\n",
  "\n## Setup Status Gate\n",
  "\n## Corpus Boundary\n",
]

/** Strip onboarding-appended workspace footer so protocol body can be compared. */
export function stripStartupPromptWorkspaceSuffix(content: string): string {
  let cut = content.length
  for (const marker of STARTUP_METADATA_MARKERS) {
    const idx = content.indexOf(marker)
    if (idx >= 0 && idx < cut) cut = idx
  }
  return content.slice(0, cut).replace(/\s+$/u, "") + "\n"
}

/** Extract onboarding footer (metadata / setup gate / corpus boundary) if present. */
export function extractStartupPromptWorkspaceSuffix(content: string): string {
  let start = -1
  for (const marker of STARTUP_METADATA_MARKERS) {
    const idx = content.indexOf(marker)
    if (idx >= 0 && (start < 0 || idx < start)) start = idx
  }
  if (start < 0) return ""
  return content.slice(start).replace(/^\n+/u, "\n")
}

/** Merge current template body with an existing workspace-specific footer. */
export function mergeStartupPromptTemplate(templateBody: string, existingWorkspacePrompt: string): string {
  const body = stripStartupPromptWorkspaceSuffix(templateBody).replace(/\s+$/u, "")
  const suffix = extractStartupPromptWorkspaceSuffix(existingWorkspacePrompt)
  if (!suffix) return `${body}\n`
  return `${body}\n${suffix.startsWith("\n") ? suffix.slice(1) : suffix}`
}

function normalizeTrailingNewline(content: string): string {
  return content.replace(/\s+$/u, "") + "\n"
}

function sha256Text(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function readOptionalText(filePath: string): string | undefined {
  if (!existsSync(filePath)) return
  try {
    return readFileSync(filePath, "utf-8")
  } catch {
    return
  }
}

function protocolBodyForCompare(
  relativePath: string,
  content: string,
  options?: { workspacePath?: string; role?: "template" | "workspace" },
): string {
  if (relativePath === "startup-prompt.md") return stripStartupPromptWorkspaceSuffix(content)
  if ((relativePath === "AGENTS.md" || relativePath === "CLAUDE.md") && options?.workspacePath) {
    const substituted =
      options.role === "template"
        ? content.replaceAll("{{WORKSPACE_PATH}}", options.workspacePath)
        : content
    return normalizeTrailingNewline(substituted)
  }
  return normalizeTrailingNewline(content)
}

export function workspaceVersionBehindBundled(
  workspaceVersion: string | undefined,
  bundledVersion: string | undefined,
): boolean {
  const bundled = normalizeFrameworkVersion(bundledVersion)
  if (!bundled || isLegacyDevWorkspaceVersion(bundledVersion)) return false
  if (isLegacyDevWorkspaceVersion(workspaceVersion)) return true
  return compareFrameworkVersions(bundled, workspaceVersion) === 1
}

/** True when the workspace records a newer framework than this install. */
export function workspaceVersionAheadOfBundled(
  workspaceVersion: string | undefined,
  bundledVersion: string | undefined,
): boolean {
  const bundled = normalizeFrameworkVersion(bundledVersion)
  if (!bundled || isLegacyDevWorkspaceVersion(bundledVersion)) return false
  if (isLegacyDevWorkspaceVersion(workspaceVersion)) return false
  return compareFrameworkVersions(bundled, workspaceVersion) === -1
}

export function inspectTemplatePackFreshness(input: {
  workspacePath: string
  frameworkRoot?: string
  templateRoot?: string
  workspaceVersion?: string
  bundledVersion?: string
  probes?: readonly string[]
}): TemplatePackFreshness {
  const templateRoot =
    input.templateRoot ??
    (input.frameworkRoot ? resolveTemplateRootFromFrameworkRoot(input.frameworkRoot) : undefined)
  const bundledVersion =
    input.bundledVersion ??
    (input.frameworkRoot ? readFrameworkVersionFromRoot(input.frameworkRoot) : undefined)
  const workspaceVersion = input.workspaceVersion
  const probes = input.probes ?? TEMPLATE_PACK_PROTOCOL_PROBES

  const versionBehind = workspaceVersionBehindBundled(workspaceVersion, bundledVersion)
  const versionAhead = workspaceVersionAheadOfBundled(workspaceVersion, bundledVersion)
  const stalePaths: string[] = []
  const missingPaths: string[] = []

  if (templateRoot) {
    for (const relative of probes) {
      const templateFile = path.join(templateRoot, relative)
      const workspaceFile = path.join(input.workspacePath, relative)
      const templateText = readOptionalText(templateFile)
      if (templateText === undefined) continue
      const workspaceText = readOptionalText(workspaceFile)
      if (workspaceText === undefined) {
        missingPaths.push(relative)
        continue
      }
      const templateHash = sha256Text(
        protocolBodyForCompare(relative, templateText, {
          workspacePath: input.workspacePath,
          role: "template",
        }),
      )
      const workspaceHash = sha256Text(
        protocolBodyForCompare(relative, workspaceText, {
          workspacePath: input.workspacePath,
          role: "workspace",
        }),
      )
      if (templateHash !== workspaceHash) stalePaths.push(relative)
    }
  }

  const protocolBehind = stalePaths.length > 0 || missingPaths.length > 0
  const stale = versionBehind || versionAhead || protocolBehind
  const refreshRecommended = stale

  let message = "Workspace template pack is current"
  if (stale) {
    if (versionAhead) {
      message = "Workspace template pack is newer than this Spinosa install; run Update workspace to match"
    } else if (versionBehind && protocolBehind) {
      message = "Workspace template pack is stale — framework version and protocol files are behind; run Update workspace"
    } else if (versionBehind) {
      message = "Workspace template pack is stale — framework version is behind; run Update workspace"
    } else {
      message = "Workspace template pack is stale — protocol files differ from the current pack; run Update workspace"
    }
  }

  return {
    stale,
    refreshRecommended,
    versionBehind,
    versionAhead,
    protocolBehind,
    workspaceVersion,
    bundledVersion,
    stalePaths,
    missingPaths,
    message,
  }
}
