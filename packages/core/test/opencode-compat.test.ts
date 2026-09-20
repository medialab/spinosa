import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  OPENCODE_COMPAT_ENV,
  OPENCODE_CONSOLE_TRACE_ENV,
  OPENCODE_CONSOLE_MIN_VERSION,
  advertisedOpenCodeVersion,
  applyAdvertisedOpenCodeVersion,
  applyOpenCodeConsoleUserAgent,
  fetchLatestOpenCodeAiVersion,
  fetchOpenCodeConsoleByUrl,
  isOpenCodeConsoleUrl,
  isOpenCodeProviderID,
  maxOpenCodeVersion,
  openCodeClientName,
  openCodeConsoleHeaders,
  openCodeConsoleHttp,
  openCodeConsoleRequest,
  openCodeConsoleRequestFingerprint,
  openCodeUserAgent,
  pinOpenCodeConsoleUserAgent,
  parseOpenCodeVersion,
  readOpenCodeCompatCache,
  resetAdvertisedOpenCodeVersionForTests,
  syncOpenCodeCompatVersion,
  parseOpenCodeConsoleRequirement,
  adoptOpenCodeConsoleRequirement,
  writeOpenCodeCompatCache,
  type FetchLike,
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
  delete process.env[OPENCODE_CONSOLE_TRACE_ENV]
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

  test("Console identity headers use the advertised OpenCode User-Agent", () => {
    isolateCache()
    expect(isOpenCodeProviderID("opencode")).toBe(true)
    expect(isOpenCodeProviderID("opencode-go")).toBe(true)
    expect(isOpenCodeProviderID("openai")).toBe(false)
    expect(
      openCodeConsoleHeaders({
        sessionID: "ses_1",
        requestID: "msg_1",
        client: "cli",
        projectID: "prj_1",
      }),
    ).toEqual({
      "x-opencode-project": "prj_1",
      "x-opencode-session": "ses_1",
      "x-opencode-request": "msg_1",
      "x-opencode-client": "cli",
      "User-Agent": openCodeUserAgent(),
    })
  })

  test("fetch-hop User-Agent pin beats Bun and product defaults", () => {
    isolateCache()
    const expected = openCodeUserAgent()
    const fromInit = applyOpenCodeConsoleUserAgent("https://console.opencode.ai/v1/chat/completions", {
      headers: {
        "User-Agent": "spinosa/1.2.0-beta.6",
        "x-opencode-session": "ses_1",
      },
    })
    expect(fromInit.get("user-agent")).toBe(expected)
    expect(fromInit.get("x-opencode-session")).toBe("ses_1")

    const fromRequest = applyOpenCodeConsoleUserAgent(
      new Request("https://console.opencode.ai/v1/chat/completions", {
        headers: { "User-Agent": "Bun/1.2.21", "x-opencode-client": "cli" },
      }),
    )
    expect(fromRequest.get("user-agent")).toBe(expected)
    expect(fromRequest.get("x-opencode-client")).toBe("cli")
  })

  test("keeps OpenCode's AI SDK User-Agent suffix on the Request", () => {
    isolateCache()
    const official = openCodeUserAgent()
    const compound = `${official} ai-sdk/openai-compatible/1.0.0 runtime/bun/1.3.14`
    expect(pinOpenCodeConsoleUserAgent(compound)).toBe(compound)
    expect(pinOpenCodeConsoleUserAgent("ai-sdk/openai-compatible/1.0.0")).toBe(
      `${official} ai-sdk/openai-compatible/1.0.0`,
    )

    const request = openCodeConsoleRequest(
      new Request("https://console.opencode.ai/v1/chat/completions", {
        headers: { "User-Agent": compound, "x-opencode-session": "ses_1" },
      }),
    )
    expect(request.headers.get("user-agent")).toBe(compound)
    expect(request.headers.get("x-opencode-session")).toBe("ses_1")
  })

  test("openCodeConsoleRequest bakes User-Agent onto the Request object", () => {
    isolateCache()
    const expected = openCodeUserAgent()
    const request = openCodeConsoleRequest(
      new Request("https://console.opencode.ai/v1/chat/completions", {
        headers: { "User-Agent": "Bun/1.2.21" },
      }),
      { headers: { "x-opencode-session": "ses_1" } },
    )
    expect(request.headers.get("user-agent")).toBe(expected)
    expect(request.headers.get("x-opencode-session")).toBe("ses_1")
  })

  test("Console HTTP overlay pins identity headers and User-Agent last", () => {
    isolateCache()
    expect(openCodeClientName()).toBeTruthy()
    expect(isOpenCodeConsoleUrl("https://console.opencode.ai/v1/chat/completions")).toBe(true)
    expect(isOpenCodeConsoleUrl("https://api.github.com")).toBe(false)
    expect(
      openCodeConsoleHttp("opencode", {
        sessionID: "ses_1",
        requestID: "msg_compact",
        client: "cli",
        projectID: "prj_1",
      }, { headers: { "User-Agent": "spinosa/1.2.0", "x-custom": "1" } }),
    ).toEqual({
      headers: {
        "x-custom": "1",
        "x-opencode-project": "prj_1",
        "x-opencode-session": "ses_1",
        "x-opencode-request": "msg_compact",
        "x-opencode-client": "cli",
        "User-Agent": openCodeUserAgent(),
      },
    })
    expect(openCodeConsoleHttp("openai", { sessionID: "ses_1", requestID: "msg_1" })).toBeUndefined()
  })

  test("fetch wrapper only rewrites Console hosts", async () => {
    isolateCache()
    const expected = openCodeUserAgent()
    const seen: Array<{ url: string; ua: string | null }> = []
    const base: FetchLike = async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      seen.push({ url: request.url, ua: request.headers.get("user-agent") })
      return new Response("ok")
    }
    await fetchOpenCodeConsoleByUrl("https://console.opencode.ai/v1/chat/completions", {
      headers: { "User-Agent": "Bun/1.2.21" },
    }, base)
    await fetchOpenCodeConsoleByUrl("https://example.com/v1/chat/completions", {
      headers: { "User-Agent": "Bun/1.2.21" },
    }, base)
    expect(seen[0]?.ua).toBe(expected)
    expect(seen[1]?.ua).toBe("Bun/1.2.21")
  })

  test("wire fingerprint reports identity and body shape without credentials or prompt text", async () => {
    isolateCache()
    const request = openCodeConsoleRequest("https://console.opencode.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "x-opencode-session": "ses_1",
        "x-opencode-request": "msg_1",
        "x-opencode-client": "cli",
      },
      body: JSON.stringify({
        model: "big-pickle",
        stream: true,
        messages: [
          { role: "system", content: "private system" },
          { role: "user", content: "private prompt" },
        ],
        tools: [],
      }),
    })

    const fingerprint = await openCodeConsoleRequestFingerprint(request)
    expect(fingerprint).toMatchObject({
      url: "https://console.opencode.ai/v1/chat/completions",
      method: "POST",
      headers: {
        "user-agent": openCodeUserAgent(),
        "x-opencode-session": "ses_1",
        "x-opencode-request": "msg_1",
        "x-opencode-client": "cli",
      },
      body: {
        model: "big-pickle",
        stream: true,
        messageCount: 2,
        messageRoles: ["system", "user"],
        toolCount: 0,
      },
    })
    expect(fingerprint.contentLength).toBeGreaterThan(0)
    expect(JSON.stringify(fingerprint)).not.toContain("secret")
    expect(JSON.stringify(fingerprint)).not.toContain("private")
  })

  test("opt-in wire trace records response metadata", async () => {
    isolateCache()
    const tracePath = path.join(cacheDir, "console-http.jsonl")
    process.env[OPENCODE_CONSOLE_TRACE_ENV] = tracePath

    await fetchOpenCodeConsoleByUrl(
      "https://console.opencode.ai/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: "Bearer secret", "x-opencode-session": "ses_1" },
        body: JSON.stringify({ model: "big-pickle", messages: [{ role: "user", content: "private" }] }),
      },
      async () => new Response("ok", { status: 202 }),
    )

    const traced = JSON.parse(readFileSync(tracePath, "utf-8")) as Record<string, unknown>
    expect(traced.status).toBe(202)
    expect(traced.contentLength).toBeGreaterThan(0)
    expect(JSON.stringify(traced)).not.toContain("secret")
    expect(JSON.stringify(traced)).not.toContain("private")
  })
})
