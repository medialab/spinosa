import { describe, expect, test } from "bun:test"
import {
  applyTuiWorkerSmokeEnv,
  compiledTuiWorkerPath,
  describeWorkerCallError,
  evaluateParserWorkerSmoke,
  evaluateTuiWorkerSmoke,
  formatWorkerFailureForParent,
  isRecoverableWorkerFailure,
  parentActionForWorkerFailure,
  resolveParserWorkerPath,
  restoreTuiWorkerSmokeEnv,
  shouldWriteWorkerFailureToStderr,
  TUI_WORKER_FETCH_MS,
  TUI_WORKER_PROVIDER_FETCH_MS,
  remainingDeadlineMs,
  waitForParserWorkerReady,
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

  test("canvas/pdf.js boot noise from the worker isolate fails the smoke", () => {
    expect(
      evaluateTuiWorkerSmoke({
        pingOk: true,
        status: 200,
        providerCount: 4,
        bootNoise: ['Warning: Cannot polyfill `ImageData`, rendering may be broken.'],
      }).ok,
    ).toBe(false)
  })

  test("missing pty native in the worker isolate fails the smoke", () => {
    expect(evaluateTuiWorkerSmoke({ pingOk: true, status: 200, providerCount: 4, ptyOk: false }).ok).toBe(false)
  })
})

describe("describeWorkerCallError", () => {
  test("rewrites Bun's terminated-worker message", () => {
    expect(describeWorkerCallError(new Error("Worker has been terminated")).message).toBe(
      "TUI background worker died. Restart Spinosa.",
    )
  })

  test("does not dump Effect Cause objects to the parent", () => {
    const cause = { _id: "Cause", failures: [{ message: "secret" }] }
    expect(formatWorkerFailureForParent(cause)).toBe("TUI background worker failed")
    expect(formatWorkerFailureForParent(cause)).not.toContain("failures")
    expect(describeWorkerCallError(cause).message).toBe("TUI background worker failed")
  })

  test("isolates mid-session worker death from the parent process", () => {
    expect(parentActionForWorkerFailure("boot")).toBe("fail-launch")
    expect(parentActionForWorkerFailure("running")).toBe("isolate")
    expect(shouldWriteWorkerFailureToStderr("boot")).toBe(true)
    expect(shouldWriteWorkerFailureToStderr("running")).toBe(false)
    expect(isRecoverableWorkerFailure(new Error("Worker has been terminated"))).toBe(true)
    expect(isRecoverableWorkerFailure(new Error("config is invalid"))).toBe(false)
  })
})

describe("tui-worker extra-entrypoint", () => {
  test("does not import native canvas into the worker isolate", async () => {
    const source = await Bun.file(new URL("../../../src/cli/tui/worker.ts", import.meta.url)).text()
    expect(source).not.toMatch(/import\(["'][^"']*napi-canvas-force/)
    expect(source).not.toContain("ensureCanvasNativeBinding")
    expect(source).not.toMatch(/from ["']@napi-rs\/canvas["']/)
    expect(source).toContain("installSpinosaBootNoiseCapture")
    expect(source).toContain("installDomMatrixPolyfill")
  })

  test("parent skip-list includes tui-worker and parser-worker smokes so they do not stage canvas", async () => {
    const source = await Bun.file(new URL("../../../src/index.ts", import.meta.url)).text()
    expect(source).toContain('subsub === "tui-worker"')
    expect(source).toContain('subsub === "parser-worker"')
  })
})

describe("tui-worker installer smoke isolation", () => {
  test("installer smoke wall clock is 300s and ping/pty/fetch share it", async () => {
    expect(TUI_WORKER_PROVIDER_FETCH_MS).toBe(300_000)
    const source = await Bun.file(new URL("../../../src/cli/cmd/internal.ts", import.meta.url)).text()
    expect(source).toContain("remainingDeadlineMs(deadline)")
  })

  test("remainingDeadlineMs does not stack past the wall clock", () => {
    expect(remainingDeadlineMs(1_000, 0)).toBe(1_000)
    expect(remainingDeadlineMs(1_000, 400)).toBe(600)
    expect(remainingDeadlineMs(1_000, 1_000)).toBe(1)
    expect(remainingDeadlineMs(1_000, 2_000)).toBe(1)
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
    expect(env.SPINOSA_FAIL_ON_BOOT_NOISE).toBe("1")
    restoreTuiWorkerSmokeEnv(env, previous)
    expect(env.HOME).toBe("/real-home")
    expect(env.SPINOSA_HOME).toBe("/real-home/.spinosa")
    expect(env.SPINOSA_DISABLE_MODELS_FETCH).toBeUndefined()
    expect(env.SPINOSA_PURE).toBeUndefined()
    expect(env.SPINOSA_FAIL_ON_BOOT_NOISE).toBeUndefined()
  })
})

describe("parser-worker extra-entrypoint", () => {
  test("resolves the OpenTUI parser worker from kernel or repo node_modules", () => {
    expect(resolveParserWorkerPath({ compiledPath: "/$bunfs/root/parser.worker.js" })).toBe(
      "/$bunfs/root/parser.worker.js",
    )
    const found = resolveParserWorkerPath({
      kernelCwd: "/pkg",
      exists: (p) => p.endsWith("node_modules/@opentui/core/parser.worker.js") && p.includes("/pkg/"),
    })
    expect(found).toContain("@opentui/core/parser.worker.js")
  })

  test("GET_PERFORMANCE response passes; timeout and start error fail closed", () => {
    expect(evaluateParserWorkerSmoke({ ready: true })).toEqual({ ok: true })
    expect(evaluateParserWorkerSmoke({ ready: false }).ok).toBe(false)
    expect(evaluateParserWorkerSmoke({ ready: true, error: "boom" }).error).toBe("boom")
  })

  test("waitForParserWorkerReady resolves on PERFORMANCE_RESPONSE", async () => {
    await waitForParserWorkerReady({
      post: () => {},
      attachMessage: (handler) => {
        queueMicrotask(() => handler({ type: "PERFORMANCE_RESPONSE" }))
        return () => {}
      },
      attachError: () => () => {},
      timeoutMs: 100,
    })
  })
})

describe("live TUI worker fetch", () => {
  test("budget is bounded", async () => {
    expect(TUI_WORKER_FETCH_MS).toBe(120_000)
    const source = await Bun.file(new URL("../../../src/cli/cmd/tui.ts", import.meta.url)).text()
    expect(source).toContain("TUI_WORKER_FETCH_MS")
  })
})
