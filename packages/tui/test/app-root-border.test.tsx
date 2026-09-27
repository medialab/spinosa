/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { createMemo, createSignal } from "solid-js"

const RED = RGBA.fromInts(255, 80, 80)
const GREY = RGBA.fromInts(60, 60, 60)
const framed = (frame: string) => frame.includes("┌")

async function capture(
  render: () => unknown,
  toggle?: () => void,
): Promise<{ first: string; second: string }> {
  const app = await testRender(render as never, { width: 40, height: 10 })
  try {
    await app.renderOnce()
    const first = app.captureCharFrame()
    toggle?.()
    await app.renderOnce()
    const second = app.captureCharFrame()
    return { first, second }
  } finally {
    app.renderer.destroy()
  }
}

// Mirrors the app root frame in src/app.tsx: `border` owns visibility while a
// stable-identity color memo holds the last accent across the hide transition.
function rootFrame(accent: () => RGBA | undefined, stable: () => RGBA | undefined) {
  return (
    <box width={30} height={8} border={Boolean(accent())} borderColor={stable()}>
      <text>hi</text>
    </box>
  )
}

test("app root frame clears when the subagent accent unsets", async () => {
  const [accent, setAccent] = createSignal<RGBA | undefined>(RED)
  const stable = createMemo((prev: RGBA | undefined) => accent() ?? prev)
  const { first, second } = await capture(() => rootFrame(accent, stable), () => setAccent(undefined))
  expect(framed(first)).toBe(true)
  expect(framed(second)).toBe(false)
})

test("app root frame full cycle: boot clean, show, hide, re-show, hide", async () => {
  const [accent, setAccent] = createSignal<RGBA | undefined>(undefined)
  const stable = createMemo((prev: RGBA | undefined) => accent() ?? prev)
  const app = await testRender((() => rootFrame(accent, stable)) as never, { width: 40, height: 10 })
  try {
    await app.renderOnce()
    expect(framed(app.captureCharFrame())).toBe(false)
    setAccent(RED)
    await app.renderOnce()
    expect(framed(app.captureCharFrame())).toBe(true)
    setAccent(undefined)
    await app.renderOnce()
    expect(framed(app.captureCharFrame())).toBe(false)
    setAccent(GREY)
    await app.renderOnce()
    expect(framed(app.captureCharFrame())).toBe(true)
    setAccent(undefined)
    await app.renderOnce()
    expect(framed(app.captureCharFrame())).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

// Note: an earlier probe showed `borderColor` updates can repaint a stale
// border on their own, which is why the color memo above holds its identity
// instead of flipping to undefined. The two tests above pin the fixed
// pattern; reverting to the raw accessor fails the "clears" test.
