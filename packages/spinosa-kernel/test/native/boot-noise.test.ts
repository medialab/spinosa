import { describe, expect, test } from "bun:test"
import { isSpinosaBootNoise, installSpinosaBootNoiseSuppression } from "../../src/native/boot-noise"

describe("spinosa boot noise", () => {
  test("matches the canvas and pdf.js polyfill warnings", () => {
    expect(
      isSpinosaBootNoise(
        'Warning: Cannot load "@napi-rs/canvas" package: "ResolveMessage: Cannot find module \'@napi-rs/canvas\' from \'/$bunfs/root/chunk-z5p8hp1s.js\'".',
      ),
    ).toBe(true)
    expect(isSpinosaBootNoise('Cannot load "@napi-rs/canvas" package: "ResolveMessage: Cannot find module"')).toBe(
      true,
    )
    expect(isSpinosaBootNoise("Warning: Cannot polyfill `ImageData`, rendering may be broken.")).toBe(true)
    expect(isSpinosaBootNoise("Warning: Cannot polyfill `Path2D`, rendering may be broken.")).toBe(true)
    expect(isSpinosaBootNoise("Warning: Cannot polyfill `DOMMatrix`, rendering may be broken.")).toBe(true)
    expect(isSpinosaBootNoise("TUI worker failed to start")).toBe(false)
  })

  test("swallows those warnings on console.warn", () => {
    const printed: string[] = []
    const orig = console.warn
    console.warn = (...args: unknown[]) => {
      printed.push(String(args[0]))
    }
    try {
      installSpinosaBootNoiseSuppression()
      console.warn("Warning: Cannot polyfill `ImageData`, rendering may be broken.")
      console.warn("keep this")
      expect(printed).toEqual(["keep this"])
    } finally {
      console.warn = orig
    }
  })
})
