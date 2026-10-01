import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensurePrivateDirectory, protectPrivateFile } from "./private-storage"

describe("private storage permissions", () => {
  test("tightens existing data directories and credential database files", () => {
    const root = mkdtempSync(join(tmpdir(), "spinosa-private-storage-"))
    try {
      const data = join(root, "data")
      ensurePrivateDirectory(data)
      chmodSync(data, 0o755)
      ensurePrivateDirectory(data)
      expect(statSync(data).mode & 0o777).toBe(0o700)

      const db = join(data, "spinosa.db")
      writeFileSync(db, "synthetic")
      chmodSync(db, 0o644)
      protectPrivateFile(db)
      expect(statSync(db).mode & 0o777).toBe(0o600)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
