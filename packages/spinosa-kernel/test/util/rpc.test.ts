import { describe, expect, test } from "bun:test"
import { Rpc } from "../../src/util/rpc"

const methods = {
  add(input: { left: number; right: number }) {
    return input.left + input.right
  },
  async greet(input: string) {
    return `Hello, ${input}`
  },
}

type MessageHandler = (event: MessageEvent<string>) => void | Promise<void>

function createTarget() {
  const messages: string[] = []
  const target: {
    postMessage: (data: string) => void
    onmessage: MessageHandler | null
  } = {
    postMessage(data) {
      messages.push(data)
    },
    onmessage: null,
  }
  return { messages, target }
}

describe("util.rpc", () => {
  test("serializes typed calls and resolves results", async () => {
    const { messages, target } = createTarget()
    const client = Rpc.client<typeof methods>(target)

    const result = client.call("add", { left: 2, right: 3 })
    expect(messages).toHaveLength(1)
    expect(JSON.parse(messages[0]!)).toEqual({
      type: "rpc.request",
      method: "add",
      input: { left: 2, right: 3 },
      id: 0,
    })

    await target.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "rpc.result", result: 5, id: 0 }),
      }),
    )
    await expect(result).resolves.toBe(5)
  })

  test("dispatches events and supports unsubscribe", async () => {
    const { target } = createTarget()
    const client = Rpc.client<typeof methods>(target)
    const received: string[] = []
    const off = client.on<string>("greeting", (data) => received.push(data))

    await target.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "rpc.event",
          event: "greeting",
          data: "first",
        }),
      }),
    )
    off()
    await target.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "rpc.event",
          event: "greeting",
          data: "second",
        }),
      }),
    )

    expect(received).toEqual(["first"])
  })

  test("rejects calls when target cannot post", async () => {
    const { target } = createTarget()
    target.postMessage = () => {
      throw new Error("target closed")
    }
    const client = Rpc.client<typeof methods>(target)

    await expect(client.call("greet", "Ada")).rejects.toThrow("target closed")
  })

  test("failAll rejects in-flight calls when the worker dies", async () => {
    const { target } = createTarget()
    const client = Rpc.client<typeof methods>(target)
    const pending = client.call("greet", "Ada")
    client.failAll(new Error("Worker has been terminated"))
    await expect(pending).rejects.toThrow("Worker has been terminated")
  })

  test("rejects in-flight calls when the worker returns rpc.error", async () => {
    const { target } = createTarget()
    const client = Rpc.client<typeof methods>(target)
    const pending = client.call("greet", "Ada")
    await target.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "rpc.error", error: "models.dev fetch failed", id: 0 }),
      }),
    )
    await expect(pending).rejects.toThrow("models.dev fetch failed")
  })
})
