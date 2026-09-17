import { describe, expect, test } from "bun:test"
import { pasteInputText, type PasteInput } from "../../src/component/prompt/paste"

type FakeInput = PasteInput & {
  inserted: string[]
  dirty: number
}

function input(isDestroyed = false): FakeInput {
  const value: FakeInput = {
    isDestroyed,
    inserted: [],
    dirty: 0,
    insertText(text) {
      value.inserted.push(text)
    },
    getLayoutNode() {
      return {
        markDirty() {
          value.dirty += 1
        },
      }
    },
  }
  return value
}

async function nextTick() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe("prompt paste", () => {
  test("normalizes and summarizes multiline paste", async () => {
    const target = input()
    const pasted: Array<{ text: string; virtualText: string }> = []

    await pasteInputText("one\r\ntwo\rthree", {
      input: target,
      platform: "darwin",
      summaryEnabled: () => true,
      pasteText(text, virtualText) {
        pasted.push({ text, virtualText })
      },
      pasteAttachment: async () => {},
      requestRender: () => {},
    })

    expect(pasted).toEqual([{ text: "one\ntwo\nthree", virtualText: "[Pasted ~3 lines]" }])
    expect(target.inserted).toEqual([])
  })

  test("inserts short URL paste and refreshes renderer", async () => {
    const target = input()
    let renders = 0

    await pasteInputText("https://example.com\r\nnext", {
      input: target,
      platform: "darwin",
      summaryEnabled: () => false,
      pasteText: () => {},
      pasteAttachment: async () => {},
      requestRender: () => {
        renders += 1
      },
    })
    await nextTick()

    expect(target.inserted).toEqual(["https://example.com\nnext"])
    expect(target.dirty).toBe(1)
    expect(renders).toBe(1)
  })

  test("does not render after target destruction", async () => {
    const target = input(true)
    let renders = 0

    await pasteInputText("https://example.com", {
      input: target,
      platform: "darwin",
      summaryEnabled: () => false,
      pasteText: () => {},
      pasteAttachment: async () => {},
      requestRender: () => {
        renders += 1
      },
    })
    await nextTick()

    expect(target.inserted).toEqual(["https://example.com"])
    expect(target.dirty).toBe(0)
    expect(renders).toBe(0)
  })
})
