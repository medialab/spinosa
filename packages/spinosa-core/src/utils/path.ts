import { homedir } from "node:os"
import { existsSync, lstatSync, realpathSync } from "node:fs"
import path from "node:path"

export function resolveUserPath(value: string): string | undefined {
  const resolved = value.startsWith("~") ? value.replace(/^~/, homedir()) : value
  return existsSync(resolved) ? resolved : undefined
}

export function resolveExistingUserPaths(values: string[]): string[] {
  return values
    .map((value) => normalizePathInput(value))
    .filter(Boolean)
    .map((value) => resolveUserPath(value))
    .filter((value): value is string => Boolean(value))
}

export function normalizePathInput(value: string): string {
  let result = value.trim()
  if (result.length >= 2) {
    const first = result[0]
    const last = result[result.length - 1]
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      result = result.slice(1, -1)
    }
  }
  result = result.replace(/\\ /g, " ")
  return result
}

export function expandHome(path: string): string {
  if (path.startsWith("~")) {
    return path.replace(/^~/, homedir())
  }
  return path
}

export function isCloudStoragePath(path: string): boolean {
  return (
    path.includes("/Library/CloudStorage/") ||
    path.includes(".dropbox") ||
    path.includes("Dropbox") ||
    path.includes("OneDrive")
  )
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

/** Resolve an untrusted manifest path without allowing absolute paths, traversal, or symlink escapes. */
export function resolvePathWithinRoot(root: string, relativePath: string, label = "manifest path"): string {
  if (!relativePath || relativePath.includes("\0")) {
    throw new Error(`Unsafe ${label}: path is empty or contains a NUL byte`)
  }

  const portableSegments = relativePath.replaceAll("\\", "/").split("/")
  if (
    path.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
    || portableSegments.includes("..")
  ) {
    throw new Error(`Unsafe ${label}: ${JSON.stringify(relativePath)}`)
  }

  const resolvedRoot = path.resolve(root)
  const candidate = path.resolve(resolvedRoot, relativePath)
  if (candidate === resolvedRoot || !isWithinRoot(resolvedRoot, candidate)) {
    throw new Error(`Unsafe ${label}: ${JSON.stringify(relativePath)}`)
  }

  let realRoot = resolvedRoot
  let rootExists = false
  try {
    lstatSync(resolvedRoot)
    rootExists = true
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      throw new Error(`Unsafe ${label}: cannot resolve root ${JSON.stringify(root)}`, { cause: error })
    }
  }
  if (rootExists) {
    try {
      realRoot = realpathSync(resolvedRoot)
    } catch (error) {
      throw new Error(`Unsafe ${label}: root ${JSON.stringify(root)} is a dangling symlink`, { cause: error })
    }
  }

  let current = resolvedRoot
  for (const segment of path.relative(resolvedRoot, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      lstatSync(current)
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") break
      throw new Error(`Unsafe ${label}: cannot inspect ${JSON.stringify(relativePath)}`, { cause: error })
    }

    let realCurrent: string
    try {
      realCurrent = realpathSync(current)
    } catch (error) {
      throw new Error(`Unsafe ${label}: ${JSON.stringify(relativePath)} crosses a dangling symlink`, { cause: error })
    }
    if (!isWithinRoot(realRoot, realCurrent)) {
      throw new Error(`Unsafe ${label}: ${JSON.stringify(relativePath)} crosses a symlink outside its root`)
    }
  }

  return candidate
}
