import { afterEach, describe, expect, test } from "bun:test"
import {
  ensureDocumentConverters,
  registerDocumentConverterLoader,
  _resetDetectionCacheForTests,
} from "../src/tools/detection"

afterEach(() => {
  _resetDetectionCacheForTests()
})

describe("document converter loader", () => {
  test("ensureDocumentConverters calls the registered loader once", async () => {
    let calls = 0
    registerDocumentConverterLoader(async () => {
      calls++
    })
    await ensureDocumentConverters()
    await ensureDocumentConverters()
    expect(calls).toBe(1)
  })

  test("concurrent ensureDocumentConverters coalesces into one load", async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    registerDocumentConverterLoader(async () => {
      calls++
      await gate
    })
    const first = ensureDocumentConverters()
    const second = ensureDocumentConverters()
    release()
    await Promise.all([first, second])
    expect(calls).toBe(1)
  })

  test("failed load can be retried", async () => {
    let calls = 0
    registerDocumentConverterLoader(async () => {
      calls++
      if (calls === 1) throw new Error("canvas missing")
    })
    await expect(ensureDocumentConverters()).rejects.toThrow("canvas missing")
    await ensureDocumentConverters()
    expect(calls).toBe(2)
  })
})

describe("detectDocumentTools pdf probe", () => {
  test("uses a real pdf.js import instead of resolve-only availability", async () => {
    const source = await Bun.file(new URL("../src/scan/scanner.ts", import.meta.url)).text()
    expect(source).toContain("probePdfjsRuntime()")
    expect(source).toContain("probeCanvasRuntime()")
    expect(source).toContain("probeMarkitdownRuntime()")
    expect(source).not.toContain("pdfjs: pdfjsAvailable()")
  })

  test("vision-transcribe does not pull canvas at module load", async () => {
    const source = await Bun.file(new URL("../src/import/vision-transcribe.ts", import.meta.url)).text()
    expect(source).not.toMatch(/^import .* from ["']\.\/vision-image["']/m)
    expect(source).toContain('await import("./vision-image")')
  })

  test("pipeline does not pull MarkItDown at module load", async () => {
    const source = await Bun.file(new URL("../src/import/pipeline.ts", import.meta.url)).text()
    expect(source).not.toMatch(/^import .* from ["']@spinosa\/markitdown["']/m)
    expect(source).toContain("createMarkItDown()")
  })

  test("conversation barrel does not re-export import pipeline or onboarding", async () => {
    const source = await Bun.file(new URL("../src/index.ts", import.meta.url)).text()
    expect(source).not.toContain('export * from "./import/pipeline"')
    expect(source).not.toContain('export * from "./commands/onboard"')
    expect(source).not.toContain('export * from "./commands/add"')
  })
})
