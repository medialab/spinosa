import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

/** Trash destination root for a platform/home pair. Exported for tests. */
export function trashRoot(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === "darwin") return path.join(home, ".Trash")
  if (platform === "linux" || platform === "freebsd") {
    const dataHome = process.env.XDG_DATA_HOME?.trim()
    return path.join(dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(home, ".local/share"), "Trash")
  }
  throw new Error(`Trash is not supported on ${platform} — refusing to move ${home} anywhere destructive`)
}

function timestampSuffix(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function uniqueTrashDest(dir: string, base: string): string {
  const safeBase = base.replaceAll(path.sep, "_") || "workspace"
  let candidate = path.join(dir, `${safeBase}-${timestampSuffix()}`)
  for (let attempt = 1; existsSync(candidate) && attempt < 100; attempt++) {
    candidate = path.join(dir, `${safeBase}-${timestampSuffix()}-${attempt}`)
  }
  if (existsSync(candidate)) {
    throw new Error(`Trash destination already exists: ${candidate}`)
  }
  return candidate
}

/** Recursive same-volume-or-not move: rename, falling back to copy + delete across devices. */
async function moveAcrossDevices(src: string, dest: string): Promise<void> {
  try {
    renameSync(src, dest)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EXDEV") throw error
  }
  cpSync(src, dest, { recursive: true })
  rmSync(src, { recursive: true, force: true })
}

/**
 * Move a file or folder to the OS trash instead of deleting it.
 * macOS → ~/.Trash; Linux → freedesktop Trash (files/ + .trashinfo).
 * Returns the trash destination path. Never deletes on failure: a failed
 * move leaves the source untouched.
 */
export async function moveToTrash(
  targetPath: string,
  options?: { platform?: NodeJS.Platform; home?: string },
): Promise<string> {
  const resolved = path.resolve(targetPath)
  if (!existsSync(resolved)) {
    throw new Error(`Nothing to trash: ${resolved}`)
  }
  const platform = options?.platform ?? process.platform
  const home = options?.home ?? homedir()
  const root = trashRoot(platform, home)
  const isLinuxTrash = platform === "linux" || platform === "freebsd"
  const filesDir = isLinuxTrash ? path.join(root, "files") : root
  mkdirSync(filesDir, { recursive: true })

  const dest = uniqueTrashDest(filesDir, path.basename(resolved))
  await moveAcrossDevices(resolved, dest)

  if (isLinuxTrash) {
    const infoDir = path.join(root, "info")
    mkdirSync(infoDir, { recursive: true })
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, "0")
    writeFileSync(
      path.join(infoDir, `${path.basename(dest)}.trashinfo`),
      [
        "[Trash Info]",
        `Path=${resolved}`,
        `DeletionDate=${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
        "",
      ].join("\n"),
    )
  }
  if (!existsSync(dest) || existsSync(resolved)) {
    throw new Error(`Trash move did not complete: ${resolved} → ${dest}`)
  }
  return dest
}
