import { describe, expect, test } from "bun:test"
import {
  applyTuiWorkerSmokeEnv,
  compiledTuiWorkerPath,
  describeWorkerCallError,
  evaluateTuiWorkerSmoke,
  restoreTuiWorkerSmokeEnv,
  TUI_WORKER_PROVIDER_FETCH_MS,
  waitForWorkerReady,
} from "../../../src/cli/tui/worker-boot"

describe("compiled TUI worker path", () => {
  test("uses bunfs worker.js, not a cwd-relative .ts path", () => {
    expect(compiledTuiWorkerPath("/$bunfs/root/")).toBe("/$bunfs/root/src/cli/tui/worker.js")
    expect(compiledTuiWorkerPath("B:/~BUN/root/")).toBe("B:/~BUN/root/src/cli/tui/worker.js")
    expect(compiledTuiWorkerPath("/$bunfs/root/")).not.toContain("worker.ts")
    expect(compiledTuiWorkerPath("/$bunfs/root/")).not.toMatch(/^\.\//)
  })

  test("build script wires the bunfs helper into the compile define", async () => {
    const source = await Bun.file(new URL("../../../script/build.ts", import.meta.url)).text()
    expect(source).toContain("compiledTuiWorkerPath")
    expect(source).toContain("SPINOSA_WORKER_PATH: compiledTuiWorkerPath(bunfsRoot)")
  })
})

describe("waitForWorkerReady", () => {
  test("resolves when ping succeeds", async () => {
    await waitForWorkerReady({
      ping: async () => ({ ok: true }),
      attachError: () => () => {},
      timeoutMs: 100,
    })
  })

  test("fails closed when the worker errors before ping", async () => {
    await expect(
      waitForWorkerReady({
        ping: () => new Promise(() => {}),
        attachError: (handler) => {
          queueMicrotask(() => handler(new Error("Cannot find module './src/cli/tui/worker.ts'")))
          return () => {}
        },
        timeoutMs: 100,
      }),
    ).rejects.toThrow("TUI worker failed to start")
  })

  test("fails closed when ping never returns", async () => {
    await expect(
      waitForWorkerReady({
        ping: () => new Promise(() => {}),
        attachError: () => () => {},
        timeoutMs: 20,
      }),
    ).rejects.toThrow("did not become ready")
  })
})

describe("evaluateTuiWorkerSmoke (fail closed)", () => {
  test("dead worker / terminated fetch fails", () => {
    expect(evaluateTuiWorkerSmoke({ pingOk: false }).ok).toBe(false)
    expect(
      evaluateTuiWorkerSmoke({ pingOk: true, fetchError: "Worker has been terminated" }).error,
    ).toBe("TUI worker was terminated before /provider returned")
  })

  test("empty catalog fails even if the worker is alive", () => {
    expect(evaluateTuiWorkerSmoke({ pingOk: true, status: 200, providerCount: 0 }).ok).toBe(false)
    expect(evaluateTuiWorkerSmoke({ pingOk: true, status: 500, providerCount: 3 }).ok).toBe(false)
  })

  test("non-empty /provider through the worker passes", () => {
    expect(evaluateTuiWorkerSmoke({ pingOk: true, status: 200, providerCount: 4 })).toEqual({
      ok: true,
      providers: 4,
    })
  })
})

describe("describeWorkerCallError", () => {
  test("rewrites Bun's terminated-worker message", () => {
    expect(describeWorkerCallError(new Error("Worker has been terminated")).message).toBe(
      "TUI background worker died. Restart Spinosa.",
    )
  })
})

describe("tui-worker extra-entrypoint", () => {
  test("does not import native canvas into the worker isolate", async () => {
    const source = await Bun.file(new URL("../../../src/cli/tui/worker.ts", import.meta.url)).text()
    expect(source).not.toMatch(/import\(["'][^"']*napi-canvas-force/)
    expect(source).not.toContain("ensureCanvasNativeBinding")
    expect(source).not.toMatch(/from ["']@napi-rs\/canvas["']/)
    expect(source).toContain("installSpinosaBootNoiseSuppression")
    expect(source).toContain("installDomMatrixPolyfill")
  })

  test("parent skip-list includes tui-worker smoke so it does not stage canvas", async () => {
    const source = await Bun.file(new URL("../../../src/index.ts", import.meta.url)).text()
    expect(source).toContain('subsub === "tui-worker"')
  })
})

describe("tui-worker installer smoke isolation", () => {
  test("fail-closed /provider budget stays 30s", () => {
    expect(TUI_WORKER_PROVIDER_FETCH_MS).toBe(30_000)
  })

  test("smoke uses a fresh HOME and disables models.dev plus plugins", async () => {
    const source = await Bun.file(new URL("../../../src/cli/cmd/internal.ts", import.meta.url)).text()
    expect(source).toContain("applyTuiWorkerSmokeEnv")
    expect(source).toContain("spinosa-tui-worker-home-")
    expect(source).toContain("TUI_WORKER_PROVIDER_FETCH_MS")
  })

  test("applyTuiWorkerSmokeEnv isolates HOME and restores it", () => {
    const env: NodeJS.ProcessEnv = { HOME: "/real-home", SPINOSA_HOME: "/real-home/.spinosa" }
    const previous = applyTuiWorkerSmokeEnv(env, "/tmp/smoke-home")
    expect(env.HOME).toBe("/tmp/smoke-home")
    expect(env.SPINOSA_HOME).toBe("/tmp/smoke-home/.spinosa")
    expect(env.SPINOSA_DISABLE_MODELS_FETCH).toBe("1")
    expect(env.SPINOSA_PURE).toBe("1")
    restoreTuiWorkerSmokeEnv(env, previous)
    expect(env.HOME).toBe("/real-home")
    expect(env.SPINOSA_HOME).toBe("/real-home/.spinosa")
    expect(env.SPINOSA_DISABLE_MODELS_FETCH).toBeUndefined()
    expect(env.SPINOSA_PURE).toBeUndefined()
  })
})
