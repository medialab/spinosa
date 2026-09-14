import { describe, expect, test } from "bun:test"
import { PRODUCT_BINARY_TARGETS } from "../../packages/spinosa-core/src/distribution/contract.ts"
import {
  SOURCE_PINS,
  TESSERACT_VERSION,
} from "./tools-target.ts"
import {
  TOOLS_TARGETS,
  blankPng,
  parseTessdataPins,
  toolsTarballName,
} from "../build-tools-tarballs.ts"

describe("tools tarball pins (local-only bundling, no CI)", () => {
  test("pins cover the full static chain with verified shape", () => {
    expect(SOURCE_PINS.map((p) => p.file)).toEqual([
      "zlib-1.3.1.tar.gz",
      "libpng-1.6.47.tar.gz",
      "libjpeg-turbo-3.1.0.tar.gz",
      "tiff-4.7.0.tar.gz",
      "leptonica-1.87.0.tar.gz",
      "tesseract-5.5.3.tar.gz",
    ])
    for (const pin of SOURCE_PINS) {
      expect(pin.url.startsWith("https://")).toBe(true)
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(pin.version.length).toBeGreaterThan(0)
    }
    expect(SOURCE_PINS.find((p) => p.file.startsWith("tesseract-"))?.version).toBe(TESSERACT_VERSION)
  })

  test("asset names match the canonical contract for all four targets", () => {
    expect([...TOOLS_TARGETS].sort()).toEqual([...PRODUCT_BINARY_TARGETS].sort())
    for (const target of TOOLS_TARGETS) {
      expect(toolsTarballName(target)).toBe(`spinosa-tools-${target}.tar.gz`)
    }
  })

  test("tessdata pins parse from install.sh (single source of truth)", async () => {
    const installSh = await Bun.file(new URL("../../install.sh", import.meta.url)).text()
    const pins = parseTessdataPins(installSh)
    expect(pins.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(pins.base).toContain(pins.commit)
    for (const lang of ["eng", "ita", "fra"] as const) {
      expect(pins.sha[lang]).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  test("blank PNG probe fixture is a valid PNG", () => {
    const png = blankPng(200, 60)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR")
    expect(png.readUInt32BE(16)).toBe(200)
    expect(png.readUInt32BE(20)).toBe(60)
    expect(png.subarray(-8).toString("ascii")).toContain("IEND")
  })

  test("blank PNG scanlines decode with filter byte 0", async () => {
    const { inflateSync } = await import("node:zlib")
    const png = blankPng(16, 4)
    // sig(8) + IHDR chunk (25) → IDAT length at 33, data at 41.
    const idatLen = png.readUInt32BE(33)
    expect(png.subarray(37, 41).toString("ascii")).toBe("IDAT")
    const raw = inflateSync(png.subarray(41, 41 + idatLen))
    expect(raw.length).toBe(4 * (1 + 16 * 3))
    for (let row = 0; row < 4; row++) {
      expect(raw[row * (1 + 16 * 3)]).toBe(0)
    }
  })

  test("release inventory records the tools build versions", async () => {
    const { buildInventory } = await import("./inventory.ts")
    const inv = buildInventory()
    expect(inv.toolsBuild.tesseract).toBe(TESSERACT_VERSION)
    expect(inv.toolsBuild.leptonica).toBe(
      SOURCE_PINS.find((p) => p.file.startsWith("leptonica-"))?.version,
    )
  })

  test("build module pins the same tesseract version", async () => {
    const module = await Bun.file(new URL("./tools-target.ts", import.meta.url)).text()
    expect(module).toContain(`TESSERACT_VERSION = "${TESSERACT_VERSION}"`)
  })
})
