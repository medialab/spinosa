import { describe, expect, test } from "bun:test"
import {
  compiledTuiWorkerPath,
  describeWorkerCallError,
  evaluateTuiWorkerSmoke,
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
