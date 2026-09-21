import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { productHomeDir } from "@spinosa/kernel-core/util/user-dirs"
import { moveToTrash } from "../utils/trash"
import { isSpinosaWorkspace } from "./meta"
import { unregisterWorkspace } from "./registry"

export type DeleteWorkspaceResult =
  | { ok: true; action: "trashed"; path: string; trashPath: string }
  | { ok: true; action: "unregistered"; path: string; reason: "missing" | "not_workspace" }
  | { ok: false; error: string }

/**
 * Remove a workspace from the machine registry.
 * Present Spinosa folders go to the OS trash first; missing/invalid paths only unregister.
 */
export async function deleteWorkspace(
  workspacePath: string,
  options?: { home?: string },
): Promise<DeleteWorkspaceResult> {
  const resolved = path.resolve(workspacePath)
  const home = path.resolve(options?.home ?? homedir())
  const protectedPaths = new Set([
    home,
    path.sep,
    path.resolve(home, ".spinosa"),
    path.resolve(productHomeDir()),
  ])
  if (protectedPaths.has(resolved)) {
    return { ok: false, error: `Refusing to delete protected path: ${resolved}` }
  }

  if (existsSync(resolved) && isSpinosaWorkspace(resolved)) {
    try {
      const trashPath = await moveToTrash(resolved, options?.home ? { home: options.home } : undefined)
      await unregisterWorkspace(resolved)
      return { ok: true, action: "trashed", path: resolved, trashPath }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  if (!existsSync(resolved)) {
    await unregisterWorkspace(resolved)
    return { ok: true, action: "unregistered", path: resolved, reason: "missing" }
  }

  await unregisterWorkspace(resolved)
  return { ok: true, action: "unregistered", path: resolved, reason: "not_workspace" }
}
