import { describe, expect, test } from "bun:test"
import { commandNeedsCanvas } from "./canvas-boot"
import { napiCanvasForceModule } from "../../script/canvas-embed.ts"

describe("commandNeedsCanvas", () => {
  test("TUI boot and provider catalog smokes skip canvas", () => {
    expect(commandNeedsCanvas([])).toBe(false)
    expect(commandNeedsCanvas(["tui"])).toBe(false)
    expect(commandNeedsCanvas(["version"])).toBe(false)
    expect(commandNeedsCanvas(["internal", "template"])).toBe(false)
    expect(commandNeedsCanvas(["internal", "smoke", "provider-catalog"])).toBe(false)
    expect(commandNeedsCanvas(["internal", "smoke", "tui-worker"])).toBe(false)
    expect(commandNeedsCanvas(["internal", "smoke", "parser-worker"])).toBe(false)
  })

  test("doctor and pdf/canvas smokes still stage at start", () => {
    expect(commandNeedsCanvas(["doctor"])).toBe(true)
    expect(commandNeedsCanvas(["internal", "smoke", "native-imports"])).toBe(true)
    expect(commandNeedsCanvas(["internal", "smoke", "pdf-runtime"])).toBe(true)
  })

  test("SPINOSA_SKIP_CANVAS_STAGE=1 forces skip", () => {
    const previous = process.env.SPINOSA_SKIP_CANVAS_STAGE
    process.env.SPINOSA_SKIP_CANVAS_STAGE = "1"
    try {
      expect(commandNeedsCanvas(["doctor"])).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.SPINOSA_SKIP_CANVAS_STAGE
      else process.env.SPINOSA_SKIP_CANVAS_STAGE = previous
    }
  })
})

describe("parent canvas boot", () => {
  test("does not import napi-canvas-force until the converter loader runs", async () => {
    const source = await Bun.file(new URL("../index.ts", import.meta.url)).text()
    expect(source).toContain("registerDocumentConverterLoader")
    expect(source).toContain("commandNeedsCanvas")
    expect(source).toMatch(
      /registerDocumentConverterLoader\(async \(\) => \{[\s\S]*napi-canvas-force\.gen\.ts/,
    )
    expect(source).not.toMatch(/^await import\("\.\/generated\/napi-canvas-force\.gen\.ts"\)/m)
  })

  test("compile graph still embeds canvas packages behind loadNapiCanvas", () => {
    const generated = napiCanvasForceModule("@napi-rs/canvas-linux-x64-gnu")
    expect(generated).toContain('import "@napi-rs/canvas-linux-x64-gnu"')
    expect(generated).toContain('import "@napi-rs/canvas"')
    expect(generated).toContain("export async function loadNapiCanvas()")
  })
})
