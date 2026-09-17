import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import {
  toolsPlatformTag,
  verifyBundledTools,
} from "../src/distribution/tools"

/**
 * Standalone contract: with an empty HOME, fresh SPINOSA_HOME, restricted
 * PATH (no bun/node/python visible), and no repo files visible, Spinosa
 * resolution must be bundled-or-unavailable — never host-dependent, never
 * mutating the machine.
 */
describe("standalone install contract", () => {
  test("installer has no production package-manager calls", async () => {
    const installSh = await Bun.file(path.join(import.meta.dir, "../../../install.sh")).text()
    for (const needle of [
      "brew install",
      "apt-get install",
      "dnf install",
      "pacman -S",
    ]) {
      expect(installSh).not.toContain(needle)
    }
    expect(installSh).toContain("never modifies the host system")
  })

  test("shipped sources probe no host-system install locations", async () => {
    // The compiled binary must not depend on, or even probe, user-installed
    // system paths.
    const sources = [
      "../src/tools/detection.ts",
    ]
    for (const rel of sources) {
      const src = await Bun.file(path.join(import.meta.dir, rel)).text()
      for (const needle of [
        "/opt/homebrew",
        "/usr/local/bin",
      ]) {
        expect(src, `${rel} must not reference host-system path ${needle}`).not.toContain(needle)
      }
    }
  })

  test("legacy bundled layout resolves nothing (no engine ships)", () => {
    const home = mkdtempSync(path.join(tmpdir(), "spinosa-standalone-"))
    try {
      // Even with stale bundled files on disk, nothing resolves: no engine
      // ships — vision model or copy-as-is (pdf.js for digital PDFs).
      const root = path.join(home, "tools", toolsPlatformTag()!)
      mkdirSync(path.join(root, "bin"), { recursive: true })
      const bin = path.join(root, "bin", "legacy-ocr")
      writeFileSync(bin, "#!/bin/sh\nexit 0\n")
      chmodSync(bin, 0o755)
      expect(verifyBundledTools(home)).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("release inventory is clean (no unexpected externals)", async () => {
    const { buildInventory, assertInventoryClean } = await import("../../../scripts/release/inventory.ts")
    const inv = buildInventory()
    expect(() => assertInventoryClean(inv)).not.toThrow()
    expect(inv.pdfEngine).toContain("pdfjs-dist")
    expect(inv.ocrEngine).toBe("removed")
  })
})
