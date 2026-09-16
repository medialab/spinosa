import { describe, expect, test } from "bun:test"
import { probeCanvas, probeMarkitdown, probePdfEngine } from "../../../src/cli/cmd/doctor-probes"

describe("doctor compiled probes", () => {
  test("doctor.ts no longer trusts moduleAvailable for canvas or pdf", async () => {
    const source = await Bun.file(new URL("../../../src/cli/cmd/doctor.ts", import.meta.url)).text()
    expect(source).not.toContain("pdfjsAvailable()")
    expect(source).not.toContain('moduleAvailable("@napi-rs/canvas"')
    expect(source).toContain("probePdfEngine()")
    expect(source).toContain("probeCanvas()")
    expect(source).toContain("if (!pdf || !markitdown || !canvas) healthy = false")
  })

  test("pdf.js actually loads", async () => {
    expect(await probePdfEngine()).toBe(true)
  })

  test("canvas actually loads", async () => {
    expect(await probeCanvas()).toBe(true)
  })

  test("markitdown actually loads", async () => {
    expect(await probeMarkitdown()).toBe(true)
  })

  test("markitdown probe loads the Spinosa fork, not markitdown-ts", async () => {
    const source = await Bun.file(new URL("../../../src/cli/cmd/doctor-probes.ts", import.meta.url)).text()
    expect(source).toContain('import("@spinosa/markitdown")')
    expect(source).not.toContain('import("markitdown-ts")')
  })
})
