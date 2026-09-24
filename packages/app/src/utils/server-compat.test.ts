import { describe, expect, test } from "bun:test"
import { createSpinosaClient } from "@spinosa/sdk/v2/client"
import { createApiForServer, createSdkForServer } from "./server"
import { adaptToLegacy, unwrapEnvelope } from "./legacy-api"
import { clearV2ProviderCredentials, createCompatibleApi, fetchActiveProviderIDs } from "./server-compat"

function setup(
  protocol: "v1" | "v2" | Promise<"v1" | "v2">,
  responses?: { vcs?: { branch: string; default_branch: string } },
  routes?: Record<string, (request: Request) => Response>,
) {
  const { api, requests, raw } = setupWithRaw(protocol, responses, routes)
  return { api, requests, raw }
}

function setupWithRaw(
  protocol: "v1" | "v2" | Promise<"v1" | "v2">,
  responses?: { vcs?: { branch: string; default_branch: string } },
  routes?: Record<string, (request: Request) => Response>,
) {
  const requests: Request[] = []
  const fetcher = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      // Mirror production routing: path parameters arrive URL-encoded.
      const pathname = decodeURIComponent(pathOf(request.url))
      if (routes?.[`${request.method} ${pathname}`]) return routes[`${request.method} ${pathname}`]!(request)
      if (request.method === "PATCH") {
        return Response.json({
          id: "ses_1",
          slug: "ses_1",
          projectID: "project",
          directory: "/repo",
          title: "Session",
          version: "1",
          time: { created: 1, updated: 1 },
        })
      }
      if (request.method === "POST" && request.url.endsWith("/prompt_async"))
        return new Response(undefined, { status: 204 })
      if (request.method === "POST" && request.url.endsWith("/prompt")) {
        return Response.json({
          admittedSeq: 1,
          id: "msg_1",
          sessionID: "ses_1",
          timeCreated: 1,
          type: "user",
          data: { text: "hello" },
          delivery: "steer",
        })
      }
      if (request.method === "GET" && pathOf(request.url) === "/vcs")
        return Response.json(responses?.vcs ?? {})
      if (request.method === "GET") return Response.json([])
      return new Response(undefined, { status: 204 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const server = { url: "http://localhost:4096" }
  const raw = createSpinosaClient({ baseUrl: server.url, fetch: fetcher, throwOnError: true })
  const api = createCompatibleApi({
    protocol: typeof protocol === "string" ? Promise.resolve(protocol) : protocol,
    current: createApiForServer({ server, fetch: fetcher }),
    raw,
    legacy: (directory) => createSdkForServer({ server, fetch: fetcher, directory, throwOnError: true }),
    directory: "/repo",
  })
  return { api, requests, raw }
}

describe("createCompatibleApi", () => {
  /*
  test("routes V1 archive through the legacy session update", async () => {
    const { api, requests } = setup("v1")
    await api.session.archive({ sessionID: "ses_1", directory: "/repo" })

    const url = new URL(requests[0]!.url)
    expect(url.pathname).toBe("/session/ses_1")
    expect(requests[0]!.headers.get("x-spinosa-directory")).toBe("%2Frepo")
    expect(requests[0]!.method).toBe("PATCH")
    expect(await requests[0]!.json()).toMatchObject({ time: { archived: expect.any(Number) } })
  })
  */

  test("converts current prompts to the V1 prompt contract", async () => {
    const { api, requests } = setup("v1")
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "hello @src/index.ts",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      files: [
        { uri: "file:///repo/src/index.ts", name: "index.ts", mention: { text: "@src/index.ts", start: 6, end: 19 } },
        { uri: "data:text/plain;base64,aGVsbG8=", name: "notes.txt" },
      ],
    })

    expect(pathOf(requests[0]!.url)).toBe("/session/ses_1/prompt_async")
    const body = await requests[0]!.json()
    expect(body).toMatchObject({
      messageID: "msg_1",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      parts: [
        { type: "text", text: "hello @src/index.ts" },
        {
          type: "file",
          mime: "text/plain",
          url: "file:///repo/src/index.ts",
          filename: "index.ts",
          source: {
            type: "file",
            text: { value: "@src/index.ts", start: 6, end: 19 },
            path: "file:///repo/src/index.ts",
          },
        },
        {
          type: "file",
          mime: "text/plain",
          url: "data:text/plain;base64,aGVsbG8=",
          filename: "notes.txt",
        },
      ],
    })
    expect(body.parts[2]).not.toHaveProperty("source")
  })

  test("preserves original parts for V1 optimistic reconciliation", async () => {
    const { api, requests } = setup("v1")
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "look",
      files: [{ uri: "data:image/png;base64,AAAA", name: "image.png" }],
      legacyParts: [
        { id: "prt_text", type: "text", text: "look" },
        { id: "prt_image", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "image.png" },
      ],
    })

    expect((await requests[0]!.json()).parts).toEqual([
      { id: "prt_text", type: "text", text: "look" },
      { id: "prt_image", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "image.png" },
    ])
  })

  test("resolves protocol detection once across implementation methods", async () => {
    let detections = 0
    const resolved = Promise.resolve<"v1" | "v2">("v2")
    const protocol = new Proxy(resolved, {
      get(target, property) {
        if (property !== "then") return Reflect.get(target, property, target)
        detections++
        return target.then.bind(target)
      },
    })
    const { api } = setup(protocol)

    await api.session.list()
    await api.session.list()

    expect(detections).toBe(1)
  })

  /*
  test("keeps V2 session actions on the current API", async () => {
    const { api, requests } = setup("v2")
    await api.session.archive({ sessionID: "ses_1" })

    expect(pathOf(requests[0]!.url)).toBe("/api/session/ses_1/archive")
    expect(requests[0]!.method).toBe("POST")
  })
  */

  test("uses the global V1 session search endpoint", async () => {
    const { api, requests } = setup("v1")
    await api.session.list({ parentID: null, search: "session", limit: 50 })

    expect(pathOf(requests[0]!.url)).toBe("/experimental/session")
  })

  /*
  test("projects the V1 default branch", async () => {
    const { api } = setup("v1", { vcs: { branch: "feature", default_branch: "dev" } })

    expect(await api.vcs.get({ location: { directory: "/repo" } })).toMatchObject({
      data: { branch: "feature", defaultBranch: "dev" },
    })
  })
  */

  test("translates current file searches to the V1 dirs parameter", async () => {
    const { api, requests } = setup("v1")
    await api.file.find({ location: { directory: "/repo" }, query: "src", type: "file", limit: 20 })

    const url = new URL(requests[0]!.url)
    expect(url.pathname).toBe("/find/file")
    expect(url.searchParams.get("dirs")).toBe("false")
    expect(url.searchParams.get("limit")).toBe("20")
  })

  test("routes V1 permission replies through the requested directory", async () => {
    const { api, requests } = setup("v1")
    await api.permission.reply({
      sessionID: "ses_1",
      requestID: "permission_1",
      reply: "once",
      location: { directory: "/other" },
    })

    expect(pathOf(requests[0]!.url)).toBe("/session/ses_1/permissions/permission_1")
    expect(new URL(requests[0]!.url).searchParams.get("directory")).toBe("/other")
  })

  test("disposes the V1 instance after connecting a provider", async () => {
    const { api, requests } = setup("v1")

    await api.integration.connect.key({
      integrationID: "openrouter",
      key: "secret",
      location: { directory: "/repo" },
    })

    expect(requests.map((request) => pathOf(request.url))).toEqual([
      "/auth/openrouter",
      "/instance/dispose",
      "/instance/dispose",
    ])
    expect(requests[1]!.headers.get("x-spinosa-directory")).toBe("%2Frepo")
    expect(requests[2]!.headers.get("x-spinosa-directory")).toBeNull()
  })

  test("disposes the V1 instance after completing provider OAuth", async () => {
    const { api, requests } = setup("v1")

    await api.integration.oauth.complete({
      integrationID: "openrouter",
      attemptID: "openrouter:0",
      code: "code",
      location: { directory: "/repo" },
    })

    expect(requests.map((request) => pathOf(request.url))).toEqual([
      "/provider/openrouter/oauth/callback",
      "/instance/dispose",
      "/instance/dispose",
    ])
    expect(requests[1]!.headers.get("x-spinosa-directory")).toBe("%2Frepo")
    expect(requests[2]!.headers.get("x-spinosa-directory")).toBeNull()
  })
})

const locationOf = (url: string) => {
  const params = new URL(url).searchParams
  return (
    params.get("directory") ??
    params.get("location[directory]") ??
    params.get("location.directory") ??
    undefined
  )
}

// Path parameters arrive URL-encoded; assertions compare decoded forms.
const pathOf = (url: string) => decodeURIComponent(new URL(url).pathname)

const v2Location = { directory: "/repo", project: { id: "", directory: "/repo" } }

const modelV2 = {
  id: "gpt-4",
  providerID: "openai",
  family: "gpt",
  name: "GPT-4",
  api: { id: "gpt-4", type: "aisdk", package: "@ai-sdk/openai", url: "https://api.openai.com/v1" },
  capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
  request: { headers: { "x-test": "1" }, body: { temperature: 0.5 } },
  variants: [{ id: "fast", headers: {}, body: {} }],
  time: { released: 1700000000000 },
  cost: [{ input: 1, output: 2, cache: { read: 0.5, write: 1 } }],
  status: "active",
  enabled: true,
  limit: { context: 8000, output: 4000 },
}

const catalogProviders = [
  { id: "openai", name: "OpenAI", source: "api", env: [], options: { baseURL: "https://api.openai.com" }, models: {} },
  { id: "anthropic", name: "Anthropic", source: "api", env: [], options: {}, models: {} },
]

const v2Routes = {
  // Full catalog: the V1 root list serves connected AND available providers.
  "GET /provider": () => Response.json({ all: catalogProviders, default: {} }),
  "GET /config/providers": () =>
    Response.json({ providers: [{ id: "openai" }], default: { openai: "gpt-4" } }),
  "GET /api/model": () => Response.json({ location: v2Location, data: [modelV2] }),
  "GET /api/agent": () =>
    Response.json({
      location: v2Location,
      data: [{ id: "build", mode: "primary", hidden: false, permissions: [], request: { settings: {} } }],
    }),
  "GET /config": () => Response.json({ model: "openai/gpt-4" }),
  "GET /api/integration": () => Response.json({ location: v2Location, data: [] }),
  "GET /api/integration/openai": () =>
    Response.json({
      location: v2Location,
      data: { id: "openai", name: "OpenAI", methods: [{ type: "key" }], connections: [] },
    }),
  "POST /api/integration/openai/connect/key": () => new Response(undefined, { status: 204 }),
  "POST /api/integration/openai/connect/oauth": () =>
    Response.json({
      location: v2Location,
      data: {
        attemptID: "openai:0",
        url: "https://example.com/auth",
        instructions: "code: 123",
        mode: "code",
        time: { created: 1, expires: 2 },
      },
    }),
  "GET /api/integration/attempt/openai:0": () =>
    Response.json({ location: v2Location, data: { status: "pending", time: { created: 1, expires: 2 } } }),
  "POST /api/integration/attempt/openai:0/complete": () => new Response(undefined, { status: 204 }),
  "DELETE /api/integration/attempt/openai:0": () => new Response(undefined, { status: 204 }),
  "GET /api/reference": () =>
    Response.json({ location: v2Location, data: [{ name: "r", path: "/r", source: "file" }] }),
  "GET /command": () =>
    Response.json([{ name: "init", template: "x", model: "openai/gpt-4", subtask: false, source: "skill" }]),
  "GET /mcp": () => Response.json({ docs: { status: "connected" } }),
  "GET /experimental/resource": () =>
    Response.json({
      "docs:readme": { client: "docs", name: "readme", uri: "docs:readme", description: "d", mimeType: "text/plain" },
    }),
} satisfies Record<string, (request: Request) => Response>

describe("unwrapEnvelope", () => {
  test("unwraps the V2 transport envelope to bare data", () => {
    expect(unwrapEnvelope({ data: [1], request: {}, response: {} })).toEqual([1])
    expect(unwrapEnvelope({ data: null, request: {}, response: {} })).toBeNull()
    expect(unwrapEnvelope({ data: 42, request: {}, response: {} })).toBe(42)
    expect(unwrapEnvelope({ data: "x", request: {}, response: {} })).toBe("x")
  })

  test("unwraps the legacy data/error envelope", () => {
    expect(unwrapEnvelope({ data: { a: 1 }, error: undefined })).toEqual({ a: 1 })
  })

  test("throws envelope errors instead of returning them", () => {
    const failure = { code: "bad" }
    for (const envelope of [
      { error: failure, request: {}, response: {} },
      { data: undefined, error: failure },
    ]) {
      try {
        unwrapEnvelope(envelope)
        expect.unreachable()
      } catch (error) {
        expect(error).toBe(failure)
      }
    }
  })

  test("passes primitives, null, arrays, and void markers through", () => {
    expect(unwrapEnvelope(undefined)).toBeUndefined()
    expect(unwrapEnvelope(null)).toBeNull()
    expect(unwrapEnvelope(0)).toBe(0)
    expect(unwrapEnvelope("")).toBe("")
    expect(unwrapEnvelope([1])).toEqual([1])
    expect(unwrapEnvelope({})).toEqual({})
  })

  test("extracts subscription streams instead of burying them in promises", () => {
    async function* gen() {
      yield 1
    }
    const stream = gen()
    expect(unwrapEnvelope({ stream })).toBe(stream)
  })

  test("does not mistake domain payloads for envelopes", () => {
    const payload = { location: v2Location, data: [1] }
    expect(unwrapEnvelope(payload)).toBe(payload)
    const attempt = { attemptID: "a", url: "u" }
    expect(unwrapEnvelope(attempt)).toBe(attempt)
  })

  test("preserves async iterables returned directly", async () => {
    async function* gen() {
      yield 1
    }
    const stream = gen()
    expect(unwrapEnvelope(stream)).toBe(stream)
    const seen: unknown[] = []
    for await (const item of unwrapEnvelope(stream) as AsyncIterable<unknown>) seen.push(item)
    expect(seen).toEqual([1])
  })
})

describe("adaptToLegacy subscriptions", () => {
  test("reproduces the server-sdk consumer pattern: await then for-await", async () => {
    const events = [{ id: "1" }, { id: "2" }]
    let received: unknown
    const fake = {
      event: {
        subscribe: async (options: unknown) => {
          received = options
          return {
            stream: (async function* () {
              yield* events
            })(),
          }
        },
      },
    }
    const adapted = adaptToLegacy(fake) as typeof fake
    const signal = new AbortController().signal
    // Runtime contract: the adapter extracts { stream } to the iterable
    // itself (the legacy type still declares the envelope).
    const stream = (await adapted.event.subscribe({ signal })) as unknown as AsyncIterable<unknown>
    const seen: unknown[] = []
    for await (const event of stream) seen.push(event)
    expect(seen).toEqual(events)
    expect(received).toEqual({ signal })
  })
})

describe("createCompatibleApi V2 namespaces", () => {
  test("serves the full catalog from the V1 root list", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    const result = await api.provider.list({ location: { directory: "/repo" } })
    expect(pathOf(requests[0]!.url)).toBe("/provider")
    expect(requests[0]!.method).toBe("GET")
    expect(locationOf(requests[0]!.url)).toBe("/repo")
    expect(result.location.directory).toBe("/repo")
    expect(result.data).toMatchObject([
      { id: "openai", name: "OpenAI", package: "", settings: { baseURL: "https://api.openai.com" } },
      { id: "anthropic", name: "Anthropic", package: "" },
    ])
  })

  test("resolves single providers from the catalog, including unconnected ones", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    const result = await api.provider.get({ providerID: "anthropic" })
    expect(pathOf(requests[0]!.url)).toBe("/provider")
    expect(result.location.directory).toBe("/repo")
    expect(result.data).toMatchObject({ id: "anthropic", name: "Anthropic" })
  })

  test("rejects unknown provider IDs", async () => {
    const { api } = setup("v2", undefined, v2Routes)
    await expect(api.provider.get({ providerID: "nope" })).rejects.toThrow("Provider not found: nope")
  })

  test("maps V2 models to the legacy ModelInfo contract", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    const result = await api.model.list({ location: { directory: "/repo" } })
    expect(requests.map((request) => pathOf(request.url))).toEqual(["/provider", "/api/model"])
    expect(pathOf(requests[1]!.url)).toBe("/api/model")
    expect(locationOf(requests[1]!.url)).toBe("/repo")
    expect(result.location).toEqual(v2Location)
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({
      id: "gpt-4",
      modelID: "gpt-4",
      providerID: "openai",
      name: "GPT-4",
      package: "@ai-sdk/openai",
      headers: { "x-test": "1" },
      body: { temperature: 0.5 },
      status: "active",
      enabled: true,
    })
    expect(result.data[0]!.variants).toEqual([{ id: "fast" }])
  })

  test("prefers V1 catalog models over the V2 list", async () => {
    const { api, requests } = setup("v2", undefined, {
      ...v2Routes,
      "GET /provider": () =>
        Response.json({
          all: [
            {
              id: "anthropic",
              name: "Anthropic",
              options: {},
              models: {
                "claude-4": {
                  id: "claude-4",
                  name: "Claude 4",
                  family: "claude",
                  capabilities: { toolcall: true, input: { text: true }, output: { text: true } },
                  cost: { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
                  limit: { context: 200000, output: 64000 },
                  options: {},
                  release_date: "2025-06-01",
                },
              },
            },
          ],
          default: {},
        }),
    })
    const result = await api.model.list({ location: { directory: "/repo" } })
    expect(requests.map((request) => pathOf(request.url))).toEqual(["/provider"])
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({
      id: "claude-4",
      modelID: "claude-4",
      providerID: "anthropic",
      name: "Claude 4",
      family: "claude",
      package: undefined,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
      limit: { context: 200000, input: undefined, output: 64000 },
      enabled: true,
      status: "active",
    })
    expect(result.data[0]!.time.released).toBe(Date.parse("2025-06-01"))
  })

  test("resolves model.default from config.model", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    const result = await api.model.default({ location: { directory: "/repo" } })
    expect(requests.map((request) => pathOf(request.url))).toEqual(["/config", "/provider", "/api/model"])
    expect(result.data).toMatchObject({ id: "gpt-4", providerID: "openai" })
  })

  test("reports null default when config.model is unset", async () => {
    const { api } = setup("v2", undefined, { ...v2Routes, "GET /config": () => Response.json({}) })
    const result = await api.model.default({ location: { directory: "/repo" } })
    expect(result.data).toBeNull()
  })

  test("maps V2 agents, synthesizing the legacy name", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    const result = await api.agent.list({ location: { directory: "/repo" } })
    expect(pathOf(requests[0]!.url)).toBe("/api/agent")
    expect(result.location).toEqual(v2Location)
    expect(result.data).toMatchObject([{ id: "build", name: "build", mode: "primary" }])
  })

  test("serves V2 projected message pages for the session store", async () => {
    const userMessage = { id: "msg_1", type: "user" as const, text: "hi", time: { created: 1 } }
    const { api, requests } = setup("v2", undefined, {
      ...v2Routes,
      "GET /api/session/ses_1/message": () => Response.json({ data: [userMessage], cursor: { next: null } }),
    })
    // The generated root client has no top-level message namespace, so the
    // facade must define api.message or server-session's V2 branch stays dead.
    const result = await api.message.list({ sessionID: "ses_1", limit: 20, order: "desc" })
    expect(pathOf(requests[0]!.url)).toBe("/api/session/ses_1/message")
    expect(requests[0]!.method).toBe("GET")
    expect(result.data).toEqual([userMessage])
    expect(result.cursor.next).toBeNull()
  })

  test("serves single V2 projected messages for hydration", async () => {
    const userMessage = { id: "msg_1", type: "user" as const, text: "hi", time: { created: 1 } }
    const { api, requests } = setup("v2", undefined, {
      ...v2Routes,
      "GET /api/session/ses_1/message/msg_1": () => Response.json({ data: userMessage }),
    })
    const result = await api.session.message({ sessionID: "ses_1", messageID: "msg_1" })
    expect(pathOf(requests[0]!.url)).toBe("/api/session/ses_1/message/msg_1")
    expect(result).toEqual(userMessage)
  })

  test("sends explicit directory on pty create for non-GET routing", async () => {
    // PTY stays on the V1 shim for both protocols; non-GET instance routes
    // must carry ?directory= explicitly instead of relying on header-only
    // transport (stripped by some fetch wrappers).
    const { api, requests } = setup("v2", undefined, {
      ...v2Routes,
      "POST /pty": () => Response.json({ id: "pty_1", title: "probe" }),
    })
    const result = await api.pty.create({ location: { directory: "/repo" }, command: "true", title: "probe" })
    expect(requests[0]!.method).toBe("POST")
    expect(pathOf(requests[0]!.url)).toBe("/pty")
    expect(new URL(requests[0]!.url).searchParams.get("directory")).toBe("/repo")
    expect(await requests[0]!.json()).toMatchObject({ command: "true", title: "probe" })
    expect(result.data).toMatchObject({ id: "pty_1" })
    expect(result.location.directory).toBe("/repo")
  })

  test("sends explicit directory on pty remove", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    await api.pty.remove({ ptyID: "pty_1", location: { directory: "/repo" } })
    expect(requests[0]!.method).toBe("DELETE")
    expect(pathOf(requests[0]!.url)).toBe("/pty/pty_1")
    expect(new URL(requests[0]!.url).searchParams.get("directory")).toBe("/repo")
  })

  test("lists permission requests through the V1 root with legacy envelope", async () => {
    // Bootstrap permission warmup calls api.permission.request.list; the
    // generated root client only has the flat permission.list.
    const item = { id: "perm_1", sessionID: "ses_1", permission: "read", patterns: ["*"], metadata: {}, always: [] }
    const { api, requests } = setup("v2", undefined, {
      ...v2Routes,
      "GET /permission": () => Response.json([item]),
    })
    const result = await api.permission.request.list({ location: { directory: "/repo" } })
    expect(requests[0]!.method).toBe("GET")
    expect(pathOf(requests[0]!.url)).toBe("/permission")
    expect(new URL(requests[0]!.url).searchParams.get("directory")).toBe("/repo")
    expect(result.location.directory).toBe("/repo")
    expect(result.data).toMatchObject([{ id: "perm_1", sessionID: "ses_1" }])
  })

  test("lists question requests through the V1 root with legacy envelope", async () => {
    const item = { id: "q_1", sessionID: "ses_1", questions: [], tool: undefined }
    const { api, requests } = setup("v2", undefined, {
      ...v2Routes,
      "GET /question": () => Response.json([item]),
    })
    const result = await api.question.request.list({ location: { directory: "/repo" } })
    expect(pathOf(requests[0]!.url)).toBe("/question")
    expect(result.location.directory).toBe("/repo")
    expect(result.data).toEqual([item])
  })

  test("routes integration get through .v2 and merges V1 methods", async () => {
    const { api, requests } = setup("v2", undefined, {
      ...v2Routes,
      "GET /provider/auth": () =>
        Response.json({
          openai: [
            { type: "oauth", label: "ChatGPT" },
            { type: "api", label: "API key" },
          ],
          "github-copilot": [{ type: "oauth", label: "GitHub" }],
        }),
    })
    const result = await api.integration.get({ integrationID: "openai", location: { directory: "/repo" } })
    expect(requests.map((request) => pathOf(request.url)).sort()).toEqual(
      ["/api/integration/openai", "/provider/auth"].sort(),
    )
    expect(result.data).toMatchObject({ id: "openai" })
    expect(result.data!.methods).toEqual([
      { type: "key" },
      { type: "oauth", id: "v1:0", label: "ChatGPT", prompts: undefined },
    ])
  })

  test("serves V1-only oauth methods with v1-prefixed attempt ids", async () => {
    const { api } = setup("v2", undefined, {
      ...v2Routes,
      "GET /provider/auth": () =>
        Response.json({
          "github-copilot": [{ type: "oauth", label: "GitHub" }],
        }),
      "GET /api/integration/github-copilot": () =>
        Response.json({
          location: v2Location,
          data: { id: "github-copilot", name: "GitHub Copilot", methods: [], connections: [] },
        }),
    })
    const result = await api.integration.get({
      integrationID: "github-copilot",
      location: { directory: "/repo" },
    })
    expect(result.data!.methods).toEqual([{ type: "oauth", id: "v1:0", label: "GitHub", prompts: undefined }])
  })

  test("connects provider keys through .v2 and dual-writes V1 auth", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    await api.integration.connect.key({
      integrationID: "openai",
      key: "secret",
      location: { directory: "/repo" },
    })
    expect(requests.map((request) => `${request.method} ${pathOf(request.url)}`)).toEqual([
      "POST /api/integration/openai/connect/key",
      "PUT /auth/openai",
    ])
    expect(await requests[0]!.json()).toMatchObject({ key: "secret" })
    expect(await requests[1]!.json()).toMatchObject({ type: "api", key: "secret" })
    expect(requests[1]!.headers.get("x-spinosa-directory")).toBe("%2Frepo")
  })

  test("surfaces key validation failures instead of swallowing them", async () => {
    const { api } = setup("v2", undefined, {
      ...v2Routes,
      "POST /api/integration/openai/connect/key": () =>
        Response.json({ name: "InvalidRequestError", data: { message: "bad key" } }, { status: 400 }),
    })
    // The SDK wraps non-2xx bodies into Errors carrying the parsed body and
    // status under .cause; the dialog formats .message for the form.
    const error = await api
      .integration.connect.key({ integrationID: "openai", key: "bad" })
      .then(() => undefined)
      .catch((value: unknown) => value)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("bad key")
    expect((error as Error).cause).toMatchObject({
      body: { name: "InvalidRequestError", data: { message: "bad key" } },
      status: 400,
    })
  })

  test("starts OAuth through .v2 connect", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    const result = await api.integration.oauth.connect({
      integrationID: "openai",
      methodID: "default",
      inputs: {},
      location: { directory: "/repo" },
    })
    expect(requests.map((request) => `${request.method} ${pathOf(request.url)}`)).toEqual([
      "POST /api/integration/openai/connect/oauth",
    ])
    expect(await requests[0]!.json()).toMatchObject({ methodID: "default", inputs: {} })
    expect(result.data).toMatchObject({ attemptID: "openai:0", url: "https://example.com/auth" })
  })

  test("routes V1 oauth methods through the kernel authorize/callback", async () => {
    const { api, requests } = setup("v2", undefined, {
      ...v2Routes,
      "POST /provider/openai/oauth/authorize": () =>
        Response.json({ url: "https://chatgpt.com/authorize", method: 0, instructions: "open the URL" }),
      "POST /provider/openai/oauth/callback": () => new Response(undefined, { status: 204 }),
    })
    const connect = await api.integration.oauth.connect({
      integrationID: "openai",
      methodID: "v1:0",
      inputs: {},
      location: { directory: "/repo" },
    })
    expect(requests.map((request) => `${request.method} ${pathOf(request.url)}`)).toEqual([
      "POST /provider/openai/oauth/authorize",
    ])
    expect(await requests[0]!.json()).toMatchObject({ method: 0, inputs: {} })
    expect(connect.data).toMatchObject({
      attemptID: "v1:openai:0",
      url: "https://chatgpt.com/authorize",
      mode: 0,
    })

    requests.length = 0
    await api.integration.oauth.status({
      integrationID: "openai",
      attemptID: "v1:openai:0",
      location: { directory: "/repo" },
    })
    expect(requests.map((request) => `${request.method} ${pathOf(request.url)}`)).toEqual([
      "POST /provider/openai/oauth/callback",
    ])

    requests.length = 0
    await api.integration.oauth.complete({
      integrationID: "openai",
      attemptID: "v1:openai:0",
      code: "code",
      location: { directory: "/repo" },
    })
    expect(requests.map((request) => `${request.method} ${pathOf(request.url)}`)).toEqual([
      "POST /provider/openai/oauth/callback",
    ])
    expect(await requests[0]!.json()).toMatchObject({ method: 0, code: "code" })

    requests.length = 0
    await api.integration.oauth.cancel({
      integrationID: "openai",
      attemptID: "v1:openai:0",
      location: { directory: "/repo" },
    })
    expect(requests).toHaveLength(0)
  })

  test("polls OAuth attempts through .v2 status", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    const result = await api.integration.oauth.status({
      integrationID: "openai",
      attemptID: "openai:0",
      location: { directory: "/repo" },
    })
    expect(pathOf(requests[0]!.url)).toBe("/api/integration/attempt/openai:0")
    expect(result.data).toMatchObject({ status: "pending" })
  })

  test("completes OAuth through .v2 attempt completion", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    await api.integration.oauth.complete({
      integrationID: "openai",
      attemptID: "openai:0",
      code: "code",
      location: { directory: "/repo" },
    })
    expect(requests.map((request) => `${request.method} ${pathOf(request.url)}`)).toEqual([
      "POST /api/integration/attempt/openai:0/complete",
    ])
    expect(await requests[0]!.json()).toMatchObject({ code: "code" })
  })

  test("cancels OAuth attempts", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    await api.integration.oauth.cancel({
      integrationID: "openai",
      attemptID: "openai:0",
      location: { directory: "/repo" },
    })
    expect(requests.map((request) => `${request.method} ${pathOf(request.url)}`)).toEqual([
      "DELETE /api/integration/attempt/openai:0",
    ])
  })

  test("wraps V1 command items in the legacy location envelope", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    const result = await api.command.list({ location: { directory: "/repo" } })
    expect(pathOf(requests[0]!.url)).toBe("/command")
    expect(result.location.directory).toBe("/repo")
    expect(result.data).toMatchObject([{ name: "init", model: "openai/gpt-4", source: "skill" }])
  })

  test("routes reference lists through .v2", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    const result = await api.reference.list({ location: { directory: "/repo" } })
    expect(pathOf(requests[0]!.url)).toBe("/api/reference")
    expect(result.data).toMatchObject([{ name: "r", path: "/r" }])
  })

  test("synthesizes MCP servers from V1 status", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    const result = await api.mcp.list({ location: { directory: "/repo" } })
    expect(pathOf(requests[0]!.url)).toBe("/mcp")
    expect(result.location.directory).toBe("/repo")
    expect(result.data).toMatchObject([{ name: "docs", status: { status: "connected" } }])
  })

  test("maps MCP connect/disconnect server arguments to V1 names", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    await api.mcp.connect({ server: "docs", location: { directory: "/repo" } })
    await api.mcp.disconnect({ server: "docs", location: { directory: "/repo" } })
    const paths = requests.map((request) => `${request.method} ${pathOf(request.url)}`)
    expect(paths).toEqual(["POST /mcp/docs/connect", "POST /mcp/docs/disconnect"])
    expect(locationOf(requests[0]!.url)).toBe("/repo")
  })

  test("reads MCP resource catalogs from the experimental endpoint", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    const result = await api.mcp.resource.catalog({ location: { directory: "/repo" } })
    expect(pathOf(requests[0]!.url)).toBe("/experimental/resource")
    expect(result.data.resources).toEqual([
      {
        server: "docs",
        name: "readme",
        uri: "docs:readme",
        description: "d",
        mimeType: "text/plain",
      },
    ])
    expect(result.data.templates).toEqual([])
  })
})

describe("createCompatibleApi V1 namespaces", () => {
  // Under the Spinosa pin (detectServerProtocol → "v1") every namespace the
  // shape proxy advertises must resolve against V1 reads. Before the V1
  // completion, merely accessing api.provider/api.message/... scheduled an
  // unhandled "API namespace unavailable" rejection against the v1
  // implementation (seen live on load/session-nav).
  const catalogWithModels = {
    ...v2Routes,
    "GET /provider": () =>
      Response.json({
        all: [
          {
            id: "openai",
            name: "OpenAI",
            options: {},
            models: {
              "gpt-4": {
                id: "gpt-4",
                name: "GPT-4",
                family: "gpt",
                capabilities: { toolcall: true, input: { text: true }, output: { text: true } },
                cost: { input: 1, output: 2, cache: { read: 0.5, write: 1 } },
                limit: { context: 8000, output: 4000 },
                options: {},
              },
            },
          },
        ],
        default: {},
      }),
  }

  test("resolves provider, model, and agent namespaces from V1 reads", async () => {
    const { api, requests } = setup("v1", undefined, catalogWithModels)
    const providers = await api.provider.list({ location: { directory: "/repo" } })
    expect(pathOf(requests[0]!.url)).toBe("/provider")
    expect(providers.data).toMatchObject([{ id: "openai", name: "OpenAI" }])
    const single = await api.provider.get({ providerID: "openai" })
    expect(single.data).toMatchObject({ id: "openai" })
    await expect(api.provider.get({ providerID: "nope" })).rejects.toThrow("Provider not found: nope")
    const models = await api.model.list({ location: { directory: "/repo" } })
    expect(models.data).toMatchObject([{ id: "gpt-4", providerID: "openai" }])
    const agents = await api.agent.list({ location: { directory: "/repo" } })
    expect(agents.data).toMatchObject([{ id: "build", name: "build" }])
  })

  test("resolves model.default from config.model against the V1 catalog", async () => {
    const { api } = setup("v1", undefined, catalogWithModels)
    const result = await api.model.default({ location: { directory: "/repo" } })
    expect(result.data).toMatchObject({ id: "gpt-4", providerID: "openai" })
  })

  test("reads messages through the V1 projection", async () => {
    const userMessage = { id: "msg_1", sessionID: "ses_1", type: "user", text: "hi", time: { created: 1 } }
    const { api, requests } = setup("v1", undefined, {
      ...v2Routes,
      "GET /session/ses_1/message": () => Response.json([userMessage]),
      "GET /session/ses_1/message/msg_1": () => Response.json(userMessage),
    })
    const page = await api.message.list({ sessionID: "ses_1", limit: 20 })
    expect(pathOf(requests[0]!.url)).toBe("/session/ses_1/message")
    expect(page.data).toMatchObject([{ id: "msg_1" }])
    expect(page.cursor).toEqual({ previous: null, next: null })
    const single = await api.session.message({ sessionID: "ses_1", messageID: "msg_1" })
    expect(single).toMatchObject({ id: "msg_1" })
  })

  test("resolves command, reference, mcp, and integration namespaces", async () => {
    const { api, requests } = setup("v1", undefined, v2Routes)
    const commands = await api.command.list({ location: { directory: "/repo" } })
    expect(pathOf(requests[0]!.url)).toBe("/command")
    expect(commands.data).toMatchObject([{ name: "init", source: "skill" }])
    const refs = await api.reference.list({ location: { directory: "/repo" } })
    expect(refs.data).toMatchObject([{ name: "r" }])
    const mcps = await api.mcp.list({ location: { directory: "/repo" } })
    expect(mcps.data).toMatchObject([{ name: "docs" }])
    await api.mcp.connect({ server: "docs", location: { directory: "/repo" } })
    await api.mcp.disconnect({ server: "docs", location: { directory: "/repo" } })
    const integrations = await api.integration.list({ location: { directory: "/repo" } })
    expect(integrations.data).toEqual([])
  })
})

describe("createCompatibleApi directory isolation", () => {
  test("explicit locations win over the bound workspace", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    await api.provider.list({ location: { directory: "/other" } })
    expect(locationOf(requests[0]!.url)).toBe("/other")
  })

  test("unlocated calls default to the bound workspace", async () => {
    const { api, requests } = setup("v2", undefined, v2Routes)
    await api.provider.list()
    expect(locationOf(requests[0]!.url)).toBe("/repo")
  })
})

describe("fetchActiveProviderIDs", () => {
  test("unions V1 config.providers with V2 integration connections", async () => {
    const { raw } = setupWithRaw("v2", undefined, {
      ...v2Routes,
      "GET /config/providers": () => Response.json({ providers: [{ id: "openai" }], default: {} }),
      "GET /api/integration": () =>
        Response.json({
          location: v2Location,
          data: [
            { id: "openai", connections: [] },
            { id: "anthropic", connections: [{ type: "api" }] },
          ],
        }),
    })
    const active = await fetchActiveProviderIDs(raw, "/repo")
    expect(active.sort()).toEqual(["anthropic", "openai"])
  })

  test("keeps the V1 set when the V2 leg fails", async () => {
    const { raw } = setupWithRaw("v2", undefined, {
      ...v2Routes,
      "GET /config/providers": () => Response.json({ providers: [{ id: "openai" }], default: {} }),
      "GET /api/integration": () => Response.json({ error: "boom" }, { status: 500 }),
    })
    const active = await fetchActiveProviderIDs(raw, "/repo")
    expect(active).toEqual(["openai"])
  })
})

describe("clearV2ProviderCredentials", () => {
  test("removes stored credentials but preserves environment connections", async () => {
    const { raw, requests } = setupWithRaw("v2", undefined, {
      ...v2Routes,
      "GET /api/integration/openai": () =>
        Response.json({
          location: v2Location,
          data: {
            id: "openai",
            name: "OpenAI",
            methods: [{ type: "key" }],
            connections: [
              { type: "credential", id: "cred_1", label: "API key" },
              { type: "env", name: "OPENAI_API_KEY" },
            ],
          },
        }),
      "DELETE /api/credential/cred_1": () => new Response(undefined, { status: 204 }),
    })

    await clearV2ProviderCredentials(raw, "openai", "/repo")

    expect(requests.map((request) => pathOf(request.url))).toEqual([
      "/api/integration/openai",
      "/api/credential/cred_1",
    ])
    expect(requests[1]!.method).toBe("DELETE")
  })
})
