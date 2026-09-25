import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveDevelopmentFrameworkRoot, withDevelopmentFrameworkRoot } from "./framework-root"

describe("desktop framework root discovery", () => {
  test("passes the checked-out framework root to the sidecar without overriding explicit roots", () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-desktop-framework-"))
    const appPath = path.join(root, "packages", "desktop")
    const marker = path.join(root, "workspace-template", ".spinosa", "workspace-files.tsv")
    mkdirSync(path.dirname(marker), { recursive: true })
    writeFileSync(marker, "")

    try {
      expect(resolveDevelopmentFrameworkRoot(appPath)).toBe(root)
      expect(withDevelopmentFrameworkRoot({ PATH: "/bin" }, appPath)).toEqual({
        PATH: "/bin",
        SPINOSA_TEMPLATE_ROOT: root,
      })

      const explicit = { SPINOSA_FRAMEWORK_ROOT: "/custom/framework" }
      expect(withDevelopmentFrameworkRoot(explicit, appPath)).toBe(explicit)
      expect(withDevelopmentFrameworkRoot({ SPINOSA_TEMPLATE_ROOT: "/custom/template" }, appPath)).toEqual({
        SPINOSA_TEMPLATE_ROOT: "/custom/template",
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("does not invent a framework root when no ancestor has a template marker", () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-desktop-no-framework-"))
    try {
      expect(resolveDevelopmentFrameworkRoot(path.join(root, "packages", "desktop"))).toBeUndefined()
      expect(withDevelopmentFrameworkRoot({ PATH: "/bin" }, root)).toEqual({ PATH: "/bin" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
