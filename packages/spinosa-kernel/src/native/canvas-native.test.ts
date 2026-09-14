import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  ensureCanvasNativeBinding,
  resolveCanvasNativeStageDir,
} from "./canvas-native"

describe("resolveCanvasNativeStageDir", () => {
  test("prefers SPINOSA_HOME/cache/canvas-native when executable", () => {
    const scratch = mkdtempSync(path.join(tmpdir(), "spinosa-canvas-resolve-"))
    const home = path.join(scratch, "home")
    try {
      const dir = resolveCanvasNativeStageDir({
        platform: "linux",
        spinosaHomeDir: home,
        tmpDir: path.join(scratch, "tmp"),
        canExec: () => true,
      })
      expect(dir).toBe(path.join(home, "cache", "canvas-native"))
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  test("falls back to shared stage order when canvas cache is not executable", () => {
    const scratch = mkdtempSync(path.join(tmpdir(), "spinosa-canvas-resolve-"))
    const home = path.join(scratch, "home")
    const tmp = path.join(scratch, "tmp")
    try {
      const dir = resolveCanvasNativeStageDir({
        platform: "linux",
        spinosaHomeDir: home,
        xdgCacheHome: path.join(scratch, "xdg"),
        tmpDir: tmp,
        canExec: (candidate) => candidate === tmp,
      })
      expect(dir).toBe(tmp)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})

describe("ensureCanvasNativeBinding", () => {
  test("stages embedded bytes and sets NAPI_RS_NATIVE_LIBRARY_PATH", () => {
    const scratch = mkdtempSync(path.join(tmpdir(), "spinosa-canvas-stage-"))
    const stageDir = path.join(scratch, "stage")
    const embed = path.join(scratch, "skia.linux-arm64-gnu.node")
    const payload = Buffer.alloc(2048, 0xab)
    writeFileSync(embed, payload)
    const env: NodeJS.ProcessEnv = {}
    try {
      const result = ensureCanvasNativeBinding({
        binding: { name: "skia.linux-arm64-gnu.node", file: embed },
        stageDir,
        env,
      })
      expect(result.nativePath).toBe(path.join(stageDir, "skia.linux-arm64-gnu.node"))
      expect(env.NAPI_RS_NATIVE_LIBRARY_PATH).toBe(result.nativePath ?? undefined)
      expect(existsSync(result.nativePath!)).toBe(true)
      expect(readFileSync(result.nativePath!).equals(payload)).toBe(true)
      expect(result.staged).toBe(result.nativePath)

      const again = ensureCanvasNativeBinding({
        binding: { name: "skia.linux-arm64-gnu.node", file: embed },
        stageDir,
        env,
      })
      expect(again.skipped).toBe(true)
      expect(again.staged).toBeNull()
      expect(env.NAPI_RS_NATIVE_LIBRARY_PATH).toBe(result.nativePath ?? undefined)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  test("empty binding leaves path unset (dev stub)", () => {
    const env: NodeJS.ProcessEnv = {}
    const result = ensureCanvasNativeBinding({ binding: null, env, tmpDir: tmpdir() })
    expect(result.skipped).toBe(true)
    expect(result.nativePath).toBeNull()
    expect(env.NAPI_RS_NATIVE_LIBRARY_PATH).toBeUndefined()
  })
})
