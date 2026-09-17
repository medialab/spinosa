import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { productBinaryAssetName, PRODUCT_BINARY_TARGETS } from "../../packages/spinosa-core/src/distribution/contract.ts"
import { selectPromotionRun, verifyPromotedDist, type ResolvedDryRun } from "./promote.ts"

const run = (id: number, buildSha: string): ResolvedDryRun => ({ id, buildSha })

describe("selectPromotionRun", () => {
  test("picks the newest run built from the commit", () => {
    const runs = [run(1, "aaa"), run(2, "bbb"), run(3, "aaa")]
    expect(selectPromotionRun(runs, "aaa")?.id).toBe(3)
  })

  test("matches SHAs case-insensitively", () => {
    expect(selectPromotionRun([run(1, "ABCDEF")], "abcdef")?.id).toBe(1)
  })

  test("returns undefined when no run was built from the commit", () => {
    expect(selectPromotionRun([run(1, "aaa")], "zzz")).toBeUndefined()
    expect(selectPromotionRun([], "aaa")).toBeUndefined()
  })
})

describe("verifyPromotedDist", () => {
  const version = "1.1.0-beta.99"

  function fixture(): { root: string; dir: string; cleanup: () => void } {
    const root = join(tmpdir(), `spinosa-promote-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
    const dir = join(root, `v${version}`)
    mkdirSync(dir, { recursive: true })
    const files = ["install.sh", "checksums.txt", "build-manifest.json"]
    for (const target of PRODUCT_BINARY_TARGETS) files.push(productBinaryAssetName(target))
    const sums = files
      .filter((f) => f !== "checksums.txt")
      .map((f) => {
        const body = `fake bytes for ${f}\n`
        writeFileSync(join(dir, f), body)
        return `${createHash("sha256").update(body).digest("hex")}  ${f}`
      })
    writeFileSync(join(dir, "checksums.txt"), `${sums.join("\n")}\n`)
    return { root, dir, cleanup: () => rmSync(root, { recursive: true, force: true }) }
  }

  test("accepts a complete dist tree with valid checksums", async () => {
    const { root, cleanup } = fixture()
    try {
      await verifyPromotedDist(root, version)
    } finally {
      cleanup()
    }
  })

  test("rejects a missing binary", async () => {
    const { root, dir, cleanup } = fixture()
    try {
      await rmSync(join(dir, productBinaryAssetName("linux-x64")), { force: true })
      await expect(verifyPromotedDist(root, version)).rejects.toThrow("missing")
    } finally {
      cleanup()
    }
  })

  test("rejects a tampered binary", async () => {
    const { root, dir, cleanup } = fixture()
    try {
      writeFileSync(join(dir, productBinaryAssetName("darwin-arm64")), "tampered\n")
      await expect(verifyPromotedDist(root, version)).rejects.toThrow("checksum mismatch")
    } finally {
      cleanup()
    }
  })

  test("rejects a missing version directory", async () => {
    const { root, cleanup } = fixture()
    try {
      await expect(verifyPromotedDist(root, "0.0.0-nothing")).rejects.toThrow("missing")
    } finally {
      cleanup()
    }
  })
})
