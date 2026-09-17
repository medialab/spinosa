import { describe, expect, test } from "bun:test"
import {
  buildManifestAssets,
  expectedImmutableReleaseAssets,
  productBinaryAssetName,
  PRODUCT_BINARY_TARGETS,
} from "../../packages/spinosa-core/src/distribution/contract.ts"

describe("local OCR removal guards (no engine ships)", () => {
  test("tools tarball builders are deleted", async () => {
    for (const rel of ["../build-tools-tarballs.ts", "./tools-target.ts"]) {
      const file = Bun.file(new URL(rel, import.meta.url))
      expect(await file.exists(), `${rel} must be deleted`).toBe(false)
    }
  })

  test("build manifest carries product binaries only (no tools assets)", () => {
    const assets = buildManifestAssets()
    for (const target of PRODUCT_BINARY_TARGETS) {
      expect(assets[target]).toEqual({ binary: productBinaryAssetName(target) })
      expect(assets[target] as unknown as Record<string, unknown>).not.toHaveProperty("tools")
    }
  })

  test("immutable release assets exclude tools archives", () => {
    const names = expectedImmutableReleaseAssets("9.9.9")
    for (const target of PRODUCT_BINARY_TARGETS) {
      expect(names).toContain(productBinaryAssetName(target))
      expect(names).not.toContain(`spinosa-tools-${target}.tar.gz`)
    }
  })

  test("release inventory reports OCR as removed", async () => {
    const { buildInventory, assertInventoryClean } = await import("./inventory.ts")
    const inv = buildInventory()
    expect(inv.ocrEngine).toBe("removed")
    expect(Object.keys(inv).sort()).toEqual(
      ["bundledModules", "externals", "nativeBindings", "ocrEngine", "pdfEngine", "product", "runtime", "version"],
    )
    expect(() => assertInventoryClean(inv)).not.toThrow()
  })

  test("installer carries no language-data pins or downloads", async () => {
    const installSh = await Bun.file(new URL("../../install.sh", import.meta.url)).text()
    expect(installSh).not.toMatch(/^[A-Z_]*PIN_COMMIT=/m)
    expect(installSh).not.toContain("traineddata")
  })
})
