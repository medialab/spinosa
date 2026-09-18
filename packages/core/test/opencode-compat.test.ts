import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  OPENCODE_COMPAT_ENV,
  OPENCODE_CONSOLE_MIN_VERSION,
  advertisedOpenCodeVersion,
  applyAdvertisedOpenCodeVersion,
  fetchLatestOpenCodeAiVersion,
  maxOpenCodeVersion,
  openCodeUserAgent,
  parseOpenCodeVersion,
  readOpenCodeCompatCache,
  resetAdvertisedOpenCodeVersionForTests,
  syncOpenCodeCompatVersion,
  parseOpenCodeConsoleRequirement,
  adoptOpenCodeConsoleRequirement,
  writeOpenCodeCompatCache,
} from "../src/installation/opencode-compat"
import { OpenCodeCompatVersion } from "../src/installation/version"

let cacheDir = ""

afterEach(() => {
  resetAdvertisedOpenCodeVersionForTests()
  delete process.env[OPENCODE_COMPAT_ENV]
  if (cacheDir) {
    rmSync(cacheDir, { recursive: true, force: true })
    cacheDir = ""
  }
  delete process.env.SPINOSA_METADATA_DIR
})

function isolateCache(): void {
  cacheDir = mkdtempSync(path.join(tmpdir(), "spinosa-opencode-compat-"))
  process.env.SPINOSA_METADATA_DIR = cacheDir
}

describe("OpenCode Console compatibility version", () => {
  test("floor is at least 1.18.0", () => {
    expect(OPENCODE_CONSOLE_MIN_VERSION).toBe("1.18.0")
    isolateCache()
    expect(advertisedOpenCodeVersion()).toBe(maxOpenCodeVersion([OPENCODE_CONSOLE_MIN_VERSION, OpenCodeCompatVersion]))
    expect(openCodeUserAgent()).toBe(`opencode/${advertisedOpenCodeVersion()}`)
  })

  test("picks the highest valid semver", () => {
    expect(maxOpenCodeVersion(["1.17.12", "1.18.0", "v1.18.31", "local", undefined])).toBe("1.18.31")
    expect(parseOpenCodeVersion("v1.18.0")).toBe("1.18.0")
    expect(parseOpenCodeVersion("local")).toBeUndefined()
  })

  test("sync writes npm latest and sets the process env for the TUI worker", async () => {
    isolateCache()
    const result = await syncOpenCodeCompatVersion({
      fetchLatest: async () => "1.18.31",
      now: 1_000,
    })
    expect(result).toEqual({ version: "1.18.31", source: "npm" })
    expect(process.env[OPENCODE_COMPAT_ENV]).toBe("1.18.31")
    expect(advertisedOpenCodeVersion()).toBe("1.18.31")
    expect(readOpenCodeCompatCache()).toEqual({ timestamp: 1_000, version: "1.18.31" })
    expect(JSON.parse(readFileSync(path.join(cacheDir, "opencode_compat_version.json"), "utf-8")).version).toBe("1.18.31")
  })

  test("sync uses a fresh cache and does not refetch", async () => {
    isolateCache()
    await syncOpenCodeCompatVersion({ fetchLatest: async () => "1.18.31", now: 1_000 })
    resetAdvertisedOpenCodeVersionForTests()
    let fetched = 0
    const result = await syncOpenCodeCompatVersion({
      fetchLatest: async () => {
        fetched += 1
        return "9.9.9"
      },
      now: 1_000 + 60_000,
    })
    expect(fetched).toBe(0)
    expect(result.source).toBe("cache")
    expect(result.version).toBe("1.18.31")
  })

  test("sync stays on the floor when npm is unreachable", async () => {
    isolateCache()
    const result = await syncOpenCodeCompatVersion({
      fetchLatest: async () => undefined,
      now: 1_000,
    })
    expect(result.source).toBe("min")
    expect(result.version).toBe(maxOpenCodeVersion([OPENCODE_CONSOLE_MIN_VERSION, OpenCodeCompatVersion]))
  })

  test("apply never advertises below the Console floor", () => {
    isolateCache()
    expect(applyAdvertisedOpenCodeVersion("1.16.0")).toBe(
      maxOpenCodeVersion([OPENCODE_CONSOLE_MIN_VERSION, OpenCodeCompatVersion]),
    )
    expect(openCodeUserAgent().startsWith("opencode/1.18.")).toBe(true)
  })

  test("npm probe parses a latest document", async () => {
    const version = await fetchLatestOpenCodeAiVersion(async () =>
      new Response(JSON.stringify({ version: "1.18.31" }), { status: 200 }),
    )
    expect(version).toBe("1.18.31")
  })

  test("parses Console's required OpenCode floor from error text", () => {
    expect(
      parseOpenCodeConsoleRequirement(
        "Error from provider (Console): OpenCode 1.19.0 or newer is required to use the free tier.",
      ),
    ).toBe("1.19.0")
    expect(parseOpenCodeConsoleRequirement("rate limited")).toBeUndefined()
  })

  test("adopts a higher Console floor and keeps it above npm latest", async () => {
    isolateCache()
    expect(adoptOpenCodeConsoleRequirement("1.19.0")).toEqual({ version: "1.19.0", adopted: true })
    expect(adoptOpenCodeConsoleRequirement("1.19.0")).toEqual({ version: "1.19.0", adopted: false })
    expect(openCodeUserAgent()).toBe("opencode/1.19.0")
    writeOpenCodeCompatCache("1.19.0", 1_000)
    resetAdvertisedOpenCodeVersionForTests()
    delete process.env[OPENCODE_COMPAT_ENV]
    const synced = await syncOpenCodeCompatVersion({
      fetchLatest: async () => "1.18.31",
      now: 1_000 + 7 * 60 * 60 * 1000,
    })
    expect(synced.version).toBe("1.19.0")
  })
})
