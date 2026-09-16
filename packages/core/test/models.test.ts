import { describe, expect, test, beforeAll, beforeEach, afterAll } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@spinosa/kernel-core/effect/app-node-builder"
import { LayerNodePlatform } from "@spinosa/kernel-core/effect/app-node-platform"
import { LayerNode } from "@spinosa/kernel-core/effect/layer-node"
import { Flag } from "@spinosa/kernel-core/flag/flag"
import { Global } from "@spinosa/kernel-core/global"
import { ModelsDev } from "@spinosa/kernel-core/models-dev"
import { it } from "./lib/effect"
import { readFile, rm, writeFile, utimes, mkdir } from "fs/promises"
import path from "path"

// test/preload.ts pins SPINOSA_MODELS_PATH to a fixture so other tests can
// resolve providers without network. These tests need to drive the on-disk
// cache themselves and silence the eager refresh fork. Save/restore around
// the suite — never leak the mutation to subsequent test files in the same
// bun process.
const ORIGINAL_MODELS_PATH = Flag.SPINOSA_MODELS_PATH
const ORIGINAL_DISABLE_FETCH = Flag.SPINOSA_DISABLE_MODELS_FETCH
beforeAll(() => {
  Flag.SPINOSA_MODELS_PATH = undefined
  Flag.SPINOSA_DISABLE_MODELS_FETCH = true
})
afterAll(() => {
  Flag.SPINOSA_MODELS_PATH = ORIGINAL_MODELS_PATH
  Flag.SPINOSA_DISABLE_MODELS_FETCH = ORIGINAL_DISABLE_FETCH
})

const cacheFile = path.join(Global.Path.cache, "models.json")

const fixture: Record<string, ModelsDev.Provider> = {
  acme: {
    id: "acme",
    name: "Acme",
    env: ["ACME_API_KEY"],
    models: {
      "acme-1": {
        id: "acme-1",
        name: "Acme One",
        release_date: "2026-01-01",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 128000, output: 8192 },
      },
    },
  },
}

const fixture2: Record<string, ModelsDev.Provider> = {
  beta: {
    id: "beta",
    name: "Beta",
    env: ["BETA_API_KEY"],
    models: {
      "beta-1": {
        id: "beta-1",
        name: "Beta One",
        release_date: "2026-02-01",
        attachment: false,
        reasoning: true,
        temperature: false,
        tool_call: false,
        limit: { context: 64000, output: 4096 },
      },
    },
  },
}

interface MockState {
  body: string
  status: number
  calls: Array<{ url: string; userAgent: string | null }>
}

const makeMockClient = (state: Ref.Ref<MockState>) =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(state, (s) => ({
        ...s,
        calls: [...s.calls, { url: request.url, userAgent: request.headers["user-agent"] ?? null }],
      }))
      const s = yield* Ref.get(state)
      return HttpClientResponse.fromWeb(request, new Response(s.body, { status: s.status }))
    }),
  )

const buildLayer = (state: Ref.Ref<MockState>) =>
  // Layer.fresh is required because the ModelsDev implementation is a module-level Layer constant,
  // and Effect.provide uses a process-global MemoMap by default — without fresh,
  // every test would reuse the cachedInvalidateWithTTL state from the first run.
  Layer.fresh(
    AppNodeBuilder.build(ModelsDev.node, [
      [LayerNodePlatform.httpClient, Layer.succeed(HttpClient.HttpClient, makeMockClient(state))],
    ]),
  )

const writeCacheText = (text: string, mtimeMs?: number) =>
  Effect.promise(async () => {
    await mkdir(Global.Path.cache, { recursive: true })
    await writeFile(cacheFile, text)
    if (mtimeMs !== undefined) {
      const t = mtimeMs / 1000
      await utimes(cacheFile, t, t)
    }
  })

const writeCache = (data: object, mtimeMs?: number) => writeCacheText(JSON.stringify(data), mtimeMs)

const provided = <A, E>(state: Ref.Ref<MockState>, eff: Effect.Effect<A, E, ModelsDev.Service>) =>
  eff.pipe(Effect.provide(buildLayer(state)))

beforeEach(async () => {
  await rm(cacheFile, { force: true })
})

afterAll(async () => {
  await rm(cacheFile, { force: true })
})

const initialState: MockState = {
  body: JSON.stringify(fixture),
  status: 200,
  calls: [],
}

describe("ModelsDev Service", () => {
  it.live("get() returns providers from disk when cache file exists", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        ModelsDev.Service.use((s) => s.get()),
      )
      expect(result).toEqual(fixture)
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("get() returns empty catalog when disk empty, fetch disabled, and no bundled snapshot is injected", () =>
    Effect.gen(function* () {
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        ModelsDev.Service.use((s) => s.get()),
      )
      expect(result).toEqual({})
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("get() recovers from a corrupted cache file by fetching a fresh catalog", () =>
    Effect.gen(function* () {
      yield* writeCacheText("{")
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const context = yield* Layer.build(buildLayer(state))
      const result = yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          Flag.SPINOSA_DISABLE_MODELS_FETCH = false
        }),
        () => ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(context)),
        () =>
          Effect.sync(() => {
            Flag.SPINOSA_DISABLE_MODELS_FETCH = true
          }),
      )
      expect(result).toEqual(fixture2)
      expect(yield* Effect.promise(() => readFile(cacheFile, "utf8"))).toBe(JSON.stringify(fixture2))
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
    }),
  )

  it.live("get() is single-flight under concurrent calls", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const state = yield* Ref.make(initialState)
      const results = yield* provided(
        state,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          return yield* Effect.all([svc.get(), svc.get(), svc.get(), svc.get(), svc.get()], {
            concurrency: "unbounded",
          })
        }),
      )
      for (const result of results) expect(result).toEqual(fixture)
    }),
  )

  it.live("get() caches across calls (later disk writes are ignored until invalidate)", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const state = yield* Ref.make(initialState)
      const first = yield* provided(
        state,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const a = yield* svc.get()
          // mutate disk between calls — cache should mask the change
          yield* writeCache(fixture2)
          const b = yield* svc.get()
          return { a, b }
        }),
      )
      expect(first.a).toEqual(fixture)
      expect(first.b).toEqual(fixture)
    }),
  )

  it.live("refresh(true) fetches via HttpClient and updates the cache", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const result = yield* provided(
        state,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const before = yield* svc.get()
          yield* svc.refresh(true)
          const after = yield* svc.get()
          return { before, after }
        }),
      )
      expect(result.before).toEqual(fixture)
      expect(result.after).toEqual(fixture2)
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
      expect(final.calls[0].url).toContain("/api.json")
      expect(final.calls[0].userAgent).toContain("/cli")
    }),
  )

  it.live("refresh(false) skips fetch when on-disk file is fresh", () =>
    Effect.gen(function* () {
      // Fresh: mtime within the 5-minute TTL.
      yield* writeCache(fixture, Date.now() - 1000)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      yield* provided(
        state,
        ModelsDev.Service.use((s) => s.refresh(false)),
      )
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("refresh(false) fetches when on-disk file is stale", () =>
    Effect.gen(function* () {
      // Stale: mtime 10 minutes ago, beyond the 5-minute TTL.
      yield* writeCache(fixture, Date.now() - 10 * 60 * 1000)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const after = yield* provided(
        state,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(false)
          return yield* svc.get()
        }),
      )
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
      expect(after).toEqual(fixture2)
    }),
  )

  it.live("refresh swallows HTTP errors and leaves cache intact", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const state = yield* Ref.make({ ...initialState, status: 500, body: "boom" })
      const result = yield* provided(
        state,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(true)
          return yield* svc.get()
        }),
      )
      expect(result).toEqual(fixture)
      // retryTransient retries 5xx, so calls may be > 1.
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBeGreaterThanOrEqual(1)
    }),
  )
})

describe("ModelsDev catalog validation", () => {
  test("decodeUsableCatalog keeps valid entries and drops the rest", () => {
    expect(ModelsDev.decodeUsableCatalog({})).toBeUndefined()
    expect(ModelsDev.decodeUsableCatalog(null)).toBeUndefined()
    expect(ModelsDev.decodeUsableCatalog([])).toBeUndefined()
    expect(ModelsDev.decodeUsableCatalog({ version: 1 })).toBeUndefined()
    // Old incompatible envelope: providers nested under a key.
    expect(ModelsDev.decodeUsableCatalog({ providers: fixture })).toBeUndefined()
    const mixed = ModelsDev.decodeUsableCatalog({ ...fixture, broken: { nope: true } })
    expect(mixed?.usable).toEqual(fixture)
    expect(mixed?.dropped).toBe(1)
    expect(ModelsDev.decodeUsableCatalog(fixture)?.usable).toEqual(fixture)
  })

  test("formatModelsDevFetchFailure never dumps Effect Cause objects", () => {
    expect(ModelsDev.formatModelsDevFetchFailure({ _id: "Cause", failures: [{ message: "secret" }] })).toBe(
      "models.dev fetch failed",
    )
    expect(ModelsDev.formatModelsDevFetchFailure(new Error("ENOTFOUND"))).toBe(
      "models.dev fetch failed: ENOTFOUND",
    )
    expect(ModelsDev.formatModelsDevFetchFailure({ _id: "Cause", failures: [{}] })).not.toContain("failures")
  })

  test("selectCatalogFallback prefers disk, then snapshot, then undefined", () => {
    expect(ModelsDev.selectCatalogFallback({ disk: fixture, snapshotUsable: fixture2 })).toEqual(
      fixture,
    )
    expect(
      ModelsDev.selectCatalogFallback({ disk: undefined, snapshotUsable: fixture2 }),
    ).toEqual(fixture2)
    expect(
      ModelsDev.selectCatalogFallback({ disk: undefined, snapshotUsable: undefined }),
    ).toBeUndefined()
  })

  it.live("get() discards an empty cache file and fetches instead", () =>
    Effect.gen(function* () {
      yield* writeCache({})
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const context = yield* Layer.build(buildLayer(state))
      const result = yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          Flag.SPINOSA_DISABLE_MODELS_FETCH = false
        }),
        () => ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(context)),
        () =>
          Effect.sync(() => {
            Flag.SPINOSA_DISABLE_MODELS_FETCH = true
          }),
      )
      expect(result).toEqual(fixture2)
      // Poisoned file is replaced by the fetched catalog.
      expect(yield* Effect.promise(() => readFile(cacheFile, "utf8"))).toBe(JSON.stringify(fixture2))
    }),
  )

  it.live("get() discards an incompatible cache structure and fetches instead", () =>
    Effect.gen(function* () {
      yield* writeCache({ providers: fixture, version: 2 })
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const context = yield* Layer.build(buildLayer(state))
      const result = yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          Flag.SPINOSA_DISABLE_MODELS_FETCH = false
        }),
        () => ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(context)),
        () =>
          Effect.sync(() => {
            Flag.SPINOSA_DISABLE_MODELS_FETCH = true
          }),
      )
      expect(result).toEqual(fixture2)
    }),
  )

  it.live("get() keeps valid entries from a partially corrupt cache without fetching", () =>
    Effect.gen(function* () {
      yield* writeCache({ ...fixture, broken: { nope: true } })
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        ModelsDev.Service.use((s) => s.get()),
      )
      expect(result).toEqual(fixture)
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("get() survives an invalid fetch body without crashing or poisoning the cache", () =>
    Effect.gen(function* () {
      yield* writeCacheText("{")
      const state = yield* Ref.make({ ...initialState, body: "not json" })
      const context = yield* Layer.build(buildLayer(state))
      const result = yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          Flag.SPINOSA_DISABLE_MODELS_FETCH = false
        }),
        () => ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(context)),
        () =>
          Effect.sync(() => {
            Flag.SPINOSA_DISABLE_MODELS_FETCH = true
          }),
      )
      expect(result).toEqual({})
      // Corrupt file was removed and the invalid fetch was never cached.
      expect(yield* Effect.promise(() => readFile(cacheFile, "utf8").catch(() => "absent"))).toBe(
        "absent",
      )
    }),
  )

  it.live("get() fails loudly when an explicit override has no usable providers", () =>
    Effect.gen(function* () {
      const overridePath = path.join(Global.Path.cache, "override-empty.json")
      yield* Effect.promise(async () => {
        await mkdir(Global.Path.cache, { recursive: true })
        await writeFile(overridePath, "{}")
      })
      const state = yield* Ref.make(initialState)
      const context = yield* Layer.build(buildLayer(state))
      const exit = yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          Flag.SPINOSA_MODELS_PATH = overridePath
        }),
        () => Effect.exit(ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(context))),
        () =>
          Effect.sync(() => {
            Flag.SPINOSA_MODELS_PATH = undefined
          }),
      )
      expect(exit._tag).toBe("Failure")
      yield* Effect.promise(() => rm(overridePath, { force: true }))
    }),
  )
})
