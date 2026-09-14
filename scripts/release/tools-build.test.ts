import { describe, expect, test } from "bun:test"
import { PRODUCT_BINARY_TARGETS } from "../../packages/spinosa-core/src/distribution/contract.ts"
import {
  SOURCE_PINS,
  TESSERACT_VERSION,
  ccachePrefix,
} from "./tools-target.ts"
import {
  TOOLS_TARGETS,
  blankPng,
  canBuildLinuxNative,
  normalizeReuseTag,
  parseTessdataPins,
  previousReleaseTag,
  toolsTarballName,
} from "../build-tools-tarballs.ts"

describe("tools tarball pins (pinned source, local Lima or native CI runners)", () => {
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

  test("native-linux selection matrix (Lima vs native CI runners)", () => {
    // CI ubuntu runners build natively; anything else uses Lima.
    expect(canBuildLinuxNative("linux-x64", { platform: "linux", arch: "x64" })).toBe(true)
    expect(canBuildLinuxNative("linux-x64", { platform: "linux", arch: "x86_64" })).toBe(true)
    expect(canBuildLinuxNative("linux-arm64", { platform: "linux", arch: "arm64" })).toBe(true)
    expect(canBuildLinuxNative("linux-arm64", { platform: "linux", arch: "aarch64" })).toBe(true)
    // Cross-arch still needs Lima (or a matching runner).
    expect(canBuildLinuxNative("linux-x64", { platform: "linux", arch: "arm64" })).toBe(false)
    expect(canBuildLinuxNative("linux-arm64", { platform: "linux", arch: "x64" })).toBe(false)
    // Darwin hosts always use Lima for linux targets; darwin targets never native-linux.
    expect(canBuildLinuxNative("linux-x64", { platform: "darwin", arch: "arm64" })).toBe(false)
    expect(canBuildLinuxNative("darwin-arm64", { platform: "linux", arch: "arm64" })).toBe(false)
    expect(canBuildLinuxNative("darwin-x64", { platform: "darwin", arch: "arm64" })).toBe(false)
  })

  test("ccache prefix engages only when a ccache binary is visible", () => {
    expect(ccachePrefix(() => "/usr/bin/ccache")).toBe("ccache ")
    expect(ccachePrefix(() => null)).toBe("")
    expect(ccachePrefix(() => { throw new Error("nope") })).toBe("")
  })

  test("reuse tag selection prefers the greatest older beta", () => {
    expect(normalizeReuseTag("v1.1.0-beta.17.17")).toBe("v1.1.0-beta.17.17")
    expect(normalizeReuseTag("1.1.0-beta.17.17")).toBe("v1.1.0-beta.17.17")
    expect(normalizeReuseTag("garbage")).toBeUndefined()
    expect(previousReleaseTag("1.1.0-beta.17.18", [
      "v1.1.0-beta.17.17",
      "v1.1.0-beta.14",
      "v1.1.0-beta.17.18",
      "v1.1.0",
    ])).toBe("v1.1.0-beta.17.17")
    // Current and newer tags never qualify; non-beta ignored.
    expect(previousReleaseTag("1.1.0-beta.14", ["v1.1.0-beta.14", "v1.1.0-beta.17.17"])).toBeUndefined()
    expect(previousReleaseTag("1.1.0-beta.17.18", ["v1.1.0"])).toBeUndefined()
    expect(previousReleaseTag("garbage", ["v1.1.0-beta.14"])).toBeUndefined()
  })

  test("linux builders never reference Lima when native, never host paths", async () => {
    const module = await Bun.file(new URL("../build-tools-tarballs.ts", import.meta.url)).text()
    // No hardcoded system tessdata locations anywhere in the build path.
    for (const needle of [
      "/opt/homebrew",
      "/usr/local/share/tessdata",
      "/usr/share/tessdata",
      "/usr/share/tesseract-ocr",
      "/opt/local/share/tessdata",
    ]) {
      expect(module, `build script must not reference host-system path ${needle}`).not.toContain(needle)
    }
  })
})
