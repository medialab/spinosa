import { existsSync } from "node:fs"
import path from "node:path"
import type { SpinosaWorkspacePresence } from "../types"
import { isSpinosaWorkspace } from "./meta"
import { findWorkspaceMatchesByID, loadRegistry } from "./registry"
import { readWorkspaceID, type SpinosaWorkspaceID } from "./identity"

export type WorkspacePresence = {
  indexedPath: string
  indexedWorkspaceID?: SpinosaWorkspaceID
  currentWorkspaceID?: SpinosaWorkspaceID
  resolvedPath?: string
  status: SpinosaWorkspacePresence
}

export function inspectWorkspacePresence(input: {
  workspacePath: string
  workspaceID?: SpinosaWorkspaceID
  searchRoots?: string[]
}): WorkspacePresence {
  const { workspacePath, workspaceID, searchRoots = [] } = input
  if (isSpinosaWorkspace(workspacePath)) {
    const currentWorkspaceID = readWorkspaceID(workspacePath)
    if (workspaceID && currentWorkspaceID !== workspaceID) {
      return { indexedPath: workspacePath, indexedWorkspaceID: workspaceID, currentWorkspaceID, status: "identity_mismatch" }
    }
    return {
      indexedPath: workspacePath,
      indexedWorkspaceID: workspaceID,
      currentWorkspaceID,
      status: currentWorkspaceID ? "present" : "legacy",
    }
  }

  if (!existsSync(workspacePath) && workspaceID) {
    const matches = findWorkspaceMatchesByID(workspaceID, searchRoots)
    if (matches.length === 1) {
      return {
        indexedPath: workspacePath,
        indexedWorkspaceID: workspaceID,
        currentWorkspaceID: workspaceID,
        resolvedPath: matches[0],
        status: "moved",
      }
    }
  }

  return {
    indexedPath: workspacePath,
    indexedWorkspaceID: workspaceID,
    status: existsSync(workspacePath) ? "invalid" : "non_existent",
  }
}

export async function inspectRegisteredWorkspacePresence(
  workspacePath: string,
  searchRoots: string[] = [],
): Promise<WorkspacePresence> {
  const entry = (await loadRegistry(undefined, { allowMissingMarker: true }))
    .find((candidate) => candidate.path === workspacePath)
  return inspectWorkspacePresence({ workspacePath, workspaceID: entry?.workspaceID, searchRoots })
}

export function isUsableWorkspacePresence(presence: WorkspacePresence): boolean {
  return isUsableWorkspaceStatus(presence.status)
}

export function isUsableWorkspaceStatus(status: SpinosaWorkspacePresence | undefined): boolean {
  return status === undefined || status === "unknown" || status === "present" || status === "legacy"
}

export function workspacePresenceLabel(status: SpinosaWorkspacePresence | undefined): string | undefined {
  switch (status) {
    case "unknown": return "UNKNOWN"
    case "non_existent": return "NON EXISTENT"
    case "moved": return "MOVED"
    case "invalid": return "INVALID"
    case "identity_mismatch": return "ID MISMATCH"
    case "legacy": return "LEGACY"
    case "present": return "PRESENT"
    default: return undefined
  }
}
