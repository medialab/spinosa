import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { $ } from "bun"
import { stageToolsTarball } from "./smoke-install.ts"

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  scratch.push(dir)
  return dir
}

/** Minimal fake tools tarball with the installer-expected layout. */
async function fakeToolsTarball(target = "darwin-arm64"): Promise<string> {
  const work = tempDir("smoke-tools-src-")
  const root = path.join(work, "stage")
  mkdirSync(path.join(root, target, "bin"), { recursive: true })
  mkdirSync(path.join(root, target, "tessdata"), { recursive: true })
  writeFileSync(path.join(root, target, "bin", "tesseract"), "#!/bin/sh\necho fake\n")
  writeFileSync(path.join(root, target, "tessdata", "eng.traineddata"), "fake-tessdata")
  const tarball = path.join(work, `spinosa-tools-${target}.tar.gz`)
  const packed = await $`tar -czf ${tarball} -C ${root} ${target}`.nothrow()
  if (packed.exitCode !== 0) throw new Error("failed to pack fake tools tarball")
  return tarball
}

describe("smoke --tools staging (bundled-OCR proof layout)", () => {
  test("extracts to <home>/tools/<platform>/{bin,tessdata} like install.sh", async () => {
    const tarball = await fakeToolsTarball("darwin-arm64")
    const home = tempDir("smoke-tools-home-")
    await stageToolsTarball(tarball, home, "test binary")
    const bin = path.join(home, "tools", "darwin-arm64", "bin", "tesseract")
    const tess = path.join(home, "tools", "darwin-arm64", "tessdata", "eng.traineddata")
    expect(existsSync(bin)).toBe(true)
    expect(readFileSync(tess, "utf-8")).toBe("fake-tessdata")
  })

  test("missing tarball fails closed", async () => {
    const home = tempDir("smoke-tools-home-")
    expect(stageToolsTarball("/tmp/does-not-exist.tar.gz", home, "test binary")).rejects.toThrow(/not found/)
  })

  test("--tools without --binary exits non-zero", async () => {
    const root = path.resolve(import.meta.dir, "..")
    const result = await $`bun scripts/smoke-install.ts --tools /tmp/does-not-exist.tar.gz`
      .cwd(root)
      .nothrow()
      .quiet()
    expect(result.exitCode).toBe(1)
  })
})
