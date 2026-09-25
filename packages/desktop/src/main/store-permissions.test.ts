import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { protectStoreFile } from "./store-permissions"

describe("protectStoreFile", () => {
  test("tightens an existing settings file to owner-only access", () => {
    const dir = mkdtempSync(join(tmpdir(), "spinosa-store-test-"))
    try {
      const file = join(dir, "settings")
      writeFileSync(file, "{}")
      chmodSync(file, 0o644)
      protectStoreFile(file)
      expect(statSync(file).mode & 0o777).toBe(0o600)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("allows a store that has not yet been written", () => {
    expect(() => protectStoreFile(join(tmpdir(), "spinosa-store-not-created"))).not.toThrow()
  })
})
