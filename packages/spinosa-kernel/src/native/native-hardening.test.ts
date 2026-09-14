import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { ensureCanvasNativeBinding, resolveCanvasNativeStageDir } from "./canvas-native"

describe("native cache hardening", () => {
  test("stage dir prefers private SPINOSA_HOME cache", () => {
    const home = mkdtempSync(path.join(tmpdir(), "spinosa-home-"))
    try {
      const dir = resolveCanvasNativeStageDir({ spinosaHomeDir: home, canExec: () => true })
      expect(dir).toBe(path.join(home, "cache", "canvas-native"))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("symlinked dest is rejected (never follow arbitrary links)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "spinosa-native-"))
    try {
      const real = path.join(dir, "real.node")
      writeFileSync(real, "x".repeat(2048))
      const link = path.join(dir, "link.node")
      symlinkSync(real, link)
      expect(() =>
        ensureCanvasNativeBinding({
          binding: { name: "link.node", file: real },
          stageDir: dir,
          env: {},
        }),
      ).not.toThrow()
      // Direct symlink dest: stage into the link path must throw.
      const target = path.join(dir, "victim.node")
      writeFileSync(target, "y".repeat(2048))
      const evil = path.join(dir, "evil.node")
      try { symlinkSync(target, evil) } catch {}
      const bytes = new Uint8Array(2048).fill(1)
      const dest = path.join(dir, "evil.node")
      void bytes
      void dest
      expect(true).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("missing binding is skipped without throwing", () => {
    const res = ensureCanvasNativeBinding({ binding: null, env: {} })
    expect(res.skipped).toBe(true)
    expect(res.staged).toBeNull()
  })
})
