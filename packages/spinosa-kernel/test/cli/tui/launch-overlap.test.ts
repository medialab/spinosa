import { describe, expect, test } from "bun:test"
import { runOverlappedLaunch } from "../../../src/cli/tui/launch-overlap"

describe("runOverlappedLaunch", () => {
  test("spawns the worker before preflight returns continue", async () => {
    const order: string[] = []
    const result = await runOverlappedLaunch({
      skipPreflight: false,
      spawn: () => {
        order.push("spawn")
        return { id: 1 }
      },
      stop: async () => {
        order.push("stop")
      },
      preflight: async () => {
        order.push("preflight")
        return "continue"
      },
    })
    expect(result).toEqual({ status: "continue", worker: { id: 1 } })
    expect(order).toEqual(["spawn", "preflight"])
  })

  test("stops the worker when preflight exits for an upgrade", async () => {
    const order: string[] = []
    const result = await runOverlappedLaunch({
      skipPreflight: false,
      spawn: () => {
        order.push("spawn")
        return { id: 1 }
      },
      stop: async () => {
        order.push("stop")
      },
      preflight: async () => {
        order.push("preflight")
        return "exit"
      },
    })
    expect(result).toEqual({ status: "exit" })
    expect(order).toEqual(["spawn", "preflight", "stop"])
  })

  test("stops the worker when preflight throws", async () => {
    const order: string[] = []
    await expect(
      runOverlappedLaunch({
        skipPreflight: false,
        spawn: () => {
          order.push("spawn")
          return { id: 1 }
        },
        stop: async () => {
          order.push("stop")
        },
        preflight: async () => {
          order.push("preflight")
          throw new Error("network")
        },
      }),
    ).rejects.toThrow("network")
    expect(order).toEqual(["spawn", "preflight", "stop"])
  })

  test("skips preflight when requested", async () => {
    const order: string[] = []
    const result = await runOverlappedLaunch({
      skipPreflight: true,
      spawn: () => {
        order.push("spawn")
        return { id: 1 }
      },
      stop: async () => {
        order.push("stop")
      },
      preflight: async () => {
        order.push("preflight")
        return "exit"
      },
    })
    expect(result).toEqual({ status: "continue", worker: { id: 1 } })
    expect(order).toEqual(["spawn"])
  })
})
