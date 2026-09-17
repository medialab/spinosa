import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { moveToTrash, trashRoot } from "../src/utils/trash"

describe("trashRoot", () => {
  test("resolves per platform", () => {
    expect(trashRoot("darwin", "/Users/name")).toBe("/Users/name/.Trash")
    expect(trashRoot("linux", "/home/name")).toBe("/home/name/.local/share/Trash")
    expect(() => trashRoot("win32", "C:\\Users\\name")).toThrow(/not supported/)
  })
})

describe("moveToTrash", () => {
  test("moves a folder to trash and returns the destination", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-trash-"))
    const home = path.join(root, "home")
    const target = path.join(root, "workspace")
    mkdirSync(path.join(target, ".spinosa"), { recursive: true })
    writeFileSync(path.join(target, "notes.md"), "# Notes\n")
    try {
      const dest = await moveToTrash(target, { platform: "darwin", home })
      expect(existsSync(target)).toBe(false)
      expect(existsSync(dest)).toBe(true)
      expect(dest.startsWith(path.join(home, ".Trash"))).toBe(true)
      expect(existsSync(path.join(dest, "notes.md"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("writes freedesktop trashinfo on linux", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-trash-linux-"))
    const home = path.join(root, "home")
    const target = path.join(root, "workspace")
    mkdirSync(target, { recursive: true })
    writeFileSync(path.join(target, "a.md"), "a\n")
    try {
      const dest = await moveToTrash(target, { platform: "linux", home })
      expect(dest.startsWith(path.join(home, ".local/share/Trash", "files"))).toBe(true)
      const info = path.join(home, ".local/share/Trash", "info", `${path.basename(dest)}.trashinfo`)
      expect(existsSync(info)).toBe(true)
      const body = readFileSync(info, "utf-8")
      expect(body).toContain("[Trash Info]")
      expect(body).toContain(`Path=${target}`)
      expect(body).toMatch(/DeletionDate=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("unique names never collide and missing source throws", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-trash-unique-"))
    const home = path.join(root, "home")
    try {
      const first = path.join(root, "ws")
      const second = path.join(root, "ws")
      mkdirSync(first, { recursive: true })
      const destA = await moveToTrash(first, { platform: "darwin", home })
      mkdirSync(second, { recursive: true })
      const destB = await moveToTrash(second, { platform: "darwin", home })
      expect(destA).not.toBe(destB)
      expect(readdirSync(path.join(home, ".Trash"))).toHaveLength(2)
      await expect(moveToTrash(path.join(root, "missing"), { platform: "darwin", home })).rejects.toThrow(
        /Nothing to trash/,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
