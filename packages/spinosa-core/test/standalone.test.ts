import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import {
  bundledTessdataDir,
  bundledToolPath,
  toolsPlatformTag,
  verifyBundledTools,
} from "../src/distribution/tools"

/**
 * Standalone contract: with an empty HOME, fresh SPINOSA_HOME, restricted
 * PATH (no brew/apt/tesseract/poppler/bun/node/python visible), and no repo
 * files visible, Spinosa resolution must be bundled-or-unavailable — never
 * host-dependent, never mutating the machine.
 */
describe("standalone install contract", () => {
  test("installer has no production package-manager calls", async () => {
    const installSh = await Bun.file(path.join(import.meta.dir, "../../../install.sh")).text()
    for (const needle of [
      "brew install tesseract",
      "apt-get install -y tesseract",
      "dnf install -y tesseract",
      "pacman -S --noconfirm tesseract",
    ]) {
      expect(installSh).not.toContain(needle)
    }
    expect(installSh).toContain("never modifies the host system")
  })

  test("shipped sources probe no host-system install locations", async () => {
    // The compiled binary must not depend on, or even probe, user-installed
    // system paths. Dev fallback resolves bundled dir + TESSDATA_PREFIX only.
    const sources = [
      "../src/import/tesseract-ocr.ts",
      "../src/tools/detection.ts",
    ]
    for (const rel of sources) {
      const src = await Bun.file(path.join(import.meta.dir, rel)).text()
      for (const needle of [
        "/opt/homebrew",
        "/usr/local/share/tessdata",
        "/usr/share/tessdata",
        "/usr/share/tesseract-ocr",
        "/opt/local/share/tessdata",
      ]) {
        expect(src, `${rel} must not reference host-system path ${needle}`).not.toContain(needle)
      }
    }
  })

  test("tesseract resolves bundled-or-unavailable under restricted env", () => {
    const prevDev = process.env.SPINOSA_DEV_HOST_TOOLS
    // Order-independent: other test files may opt into the dev override.
    delete process.env.SPINOSA_DEV_HOST_TOOLS
    const home = mkdtempSync(path.join(tmpdir(), "spinosa-standalone-"))
    try {
      const root = path.join(home, "tools", toolsPlatformTag()!)
      mkdirSync(path.join(root, "bin"), { recursive: true })
      mkdirSync(path.join(root, "tessdata"), { recursive: true })
      const bin = path.join(root, "bin", "tesseract")
      writeFileSync(bin, "#!/bin/sh\nexit 0\n")
      chmodSync(bin, 0o755)
      for (const lang of ["eng", "ita", "fra"]) {
        writeFileSync(path.join(root, "tessdata", `${lang}.traineddata`), "data")
      }
      // Direct-home resolution works without PATH sniffing.
      expect(bundledToolPath("tesseract", home)).toBe(bin)
      expect(bundledTessdataDir(home)).toContain("tessdata")
      expect(verifyBundledTools(home)).toEqual([])
    } finally {
      if (prevDev === undefined) delete process.env.SPINOSA_DEV_HOST_TOOLS
      else process.env.SPINOSA_DEV_HOST_TOOLS = prevDev
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("release inventory is clean (no unexpected externals)", async () => {
    const { buildInventory, assertInventoryClean } = await import("../../../scripts/release/inventory.ts")
    const inv = buildInventory()
    expect(() => assertInventoryClean(inv)).not.toThrow()
    expect(inv.pdfEngine).toContain("pdfjs-dist")
    expect(inv.ocrEngine).toBe("bundled-tesseract")
  })
})
