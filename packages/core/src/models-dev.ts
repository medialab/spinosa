import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ModelsDev } from "@spinosa/schema/models-dev"
import { Global } from "./global"
import { Flag } from "./flag/flag"
import { Flock } from "./util/flock"
import { Hash } from "./util/hash"
import { FSUtil } from "./fs-util"
import { InstallationChannel, InstallationVersion } from "./installation/version"
import { EventV2 } from "./event"
import { makeGlobalNode } from "./effect/app-node"
import { httpClient } from "./effect/app-node-platform"
import { bootLog } from "./observability/boot-log"

export const CatalogModelStatus = Schema.Literals(["alpha", "beta", "deprecated"])
export type CatalogModelStatus = typeof CatalogModelStatus.Type

const USER_AGENT = `spinosa/${InstallationChannel}/${InstallationVersion}/${Flag.SPINOSA_CLIENT}`

const CostTier = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Finite,
  }),
})

const Cost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  tiers: Schema.optional(Schema.Array(CostTier)),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
})

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  temperature: Schema.optional(Schema.Boolean),
  tool_call: Schema.Boolean,
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning", "reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(Cost),
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  status: Schema.optional(CatalogModelStatus),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.String,
  env: Schema.Array(Schema.String),
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

export type Provider = Schema.Schema.Type<typeof Provider>

export const Event = ModelsDev.Event

declare const SPINOSA_MODELS_DEV: Record<string, Provider> | undefined

/**
 * Source precedence for the catalog: validated disk cache first, then the
 * validated embedded snapshot. Returns undefined when neither yields a usable
 * catalog and the caller must fetch or stay empty.
 */
export function selectCatalogFallback(input: {
  disk: Record<string, Provider> | undefined
  snapshotUsable: Record<string, Provider> | undefined
}): Record<string, Provider> | undefined {
  if (input.disk && Object.keys(input.disk).length > 0) return input.disk
  return input.snapshotUsable
}
/** One-line fetch failure. Never stringify Effect Cause graphs into the TUI. */
export function formatModelsDevFetchFailure(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "_id" in cause && cause._id === "Cause") {
    return "models.dev fetch failed"
  }
  if (cause instanceof Error && cause.message) return `models.dev fetch failed: ${cause.message}`
  if (typeof cause === "string" && cause) return `models.dev fetch failed: ${cause}`
  return "models.dev fetch failed"
}

/**
 * Keep a provider when at least one model decodes. One malformed model must
 * not drop OpenCode Zen or OpenCode Go from the connect list.
 */
export function salvageProvider(entry: unknown): Provider | undefined {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined
  const models = (entry as { models?: unknown }).models
  if (typeof models !== "object" || models === null || Array.isArray(models)) return undefined
  const kept: Record<string, unknown> = {}
  for (const [modelID, model] of Object.entries(models)) {
    try {
      Schema.decodeUnknownSync(Model)(model)
      kept[modelID] = model
    } catch {
      /* skip unusable models */
    }
  }
  if (Object.keys(kept).length === 0) return undefined
  try {
    return Schema.decodeUnknownSync(Provider)({ ...(entry as object), models: kept })
  } catch {
    return undefined
  }
}

export function decodeUsableCatalog(input: unknown): {
  usable: Record<string, Provider>
  dropped: number
} | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined
  const usable: Record<string, Provider> = {}
  let dropped = 0
  for (const [id, entry] of Object.entries(input)) {
    try {
      usable[id] = Schema.decodeUnknownSync(Provider)(entry)
    } catch {
      const salvaged = salvageProvider(entry)
      if (salvaged) usable[id] = salvaged
      else dropped += 1
    }
  }
  if (Object.keys(usable).length === 0) return undefined
  return { usable, dropped }
}

export interface Interface {
  readonly get: () => Effect.Effect<Record<string, Provider>>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@spinosa/ModelsDev") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const events = yield* EventV2.Service
    const http = HttpClient.filterStatusOk(
      (yield* HttpClient.HttpClient).pipe(
        HttpClient.retryTransient({
          retryOn: "errors-and-responses",
          times: 2,
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
        }),
      ),
    )

    const source = Flag.SPINOSA_MODELS_URL || "https://models.dev"
    const filepath = path.join(
      Global.Path.cache,
      source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
    )
    const ttl = Duration.minutes(5)
    const lockKey = `models-dev:${filepath}`

    const fresh = Effect.fnUntraced(function* () {
      const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stat) return false
      const mtime = Option.getOrElse(stat.mtime, () => new Date(0)).getTime()
      return Date.now() - mtime < Duration.toMillis(ttl)
    })

    const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
      return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
        HttpClientRequest.setHeader("User-Agent", USER_AGENT),
        http.execute,
        Effect.flatMap((res) => res.text),
        Effect.timeout("10 seconds"),
      )
    })

    // An explicit SPINOSA_MODELS_PATH override keeps strict user-controlled
    // semantics: a missing file falls through like before, but a present file
    // with no usable providers fails loudly instead of silently emptying the
    // catalog. Default cache poisoning is removed and falls through instead.
    const loadFromDisk = Effect.gen(function* () {
      const isOverride = Flag.SPINOSA_MODELS_PATH !== undefined
      const raw: unknown = yield* fs
        .readJson(Flag.SPINOSA_MODELS_PATH ?? filepath)
        .pipe(
          Effect.catch((error) => {
            if (
              !isOverride &&
              error._tag === "FileSystemError" &&
              error.method === "readJson"
            ) {
              return fs.remove(filepath, { force: true }).pipe(Effect.ignore, Effect.as(undefined))
            }
            return Effect.succeed(undefined)
          }),
        )
      if (raw === undefined) return undefined
      const decoded = decodeUsableCatalog(raw)
      if (decoded) {
        if (decoded.dropped > 0) {
          yield* Effect.logWarning(
            `ModelsDev disk catalog dropped ${decoded.dropped} unusable entries, kept ${Object.keys(decoded.usable).length}`,
          )
        }
        return decoded.usable
      }
      if (isOverride) {
        return yield* Effect.die(
          new Error(
            `SPINOSA_MODELS_PATH points at a catalog with no usable providers: ${Flag.SPINOSA_MODELS_PATH}`,
          ),
        )
      }
      yield* fs.remove(filepath, { force: true }).pipe(Effect.ignore)
      return undefined
    })

    const loadSnapshot = Effect.sync(() =>
      typeof SPINOSA_MODELS_DEV === "undefined" ? undefined : SPINOSA_MODELS_DEV,
    )

    const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
      const text = yield* fetchApi()
      // Validate before caching: a corrupt or incompatible fetch must never
      // poison the disk cache (or crash JSON.parse in populate below).
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return yield* Effect.fail(
          new Error("models.dev fetch returned invalid JSON — refusing to cache"),
        )
      }
      const decoded = decodeUsableCatalog(parsed)
      if (!decoded) {
        return yield* Effect.fail(
          new Error("models.dev fetch contained no usable providers — refusing to cache"),
        )
      }
      const tempfile = `${filepath}.${process.pid}.${Date.now()}.tmp`
      yield* fs.writeWithDirs(tempfile, text).pipe(
        Effect.andThen(fs.rename(tempfile, filepath)),
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* fs.remove(tempfile, { force: true }).pipe(Effect.ignore)
            return yield* Effect.fail(error)
          }),
        ),
      )
      return decoded.usable
    })

    const populate = Effect.gen(function* () {
      const fromDisk = yield* loadFromDisk
      const snapshot = yield* loadSnapshot
      const validSnapshot = snapshot ? decodeUsableCatalog(snapshot)?.usable : undefined
      const fallback = selectCatalogFallback({ disk: fromDisk, snapshotUsable: validSnapshot })
      if (fallback) return fallback
      if (Flag.SPINOSA_DISABLE_MODELS_FETCH) return {}
      // Flock is cross-process: concurrent opencode CLIs can race on this cache file.
      // An invalid fetch falls back to an empty catalog rather than crashing.
      const fetched: Record<string, Provider> | undefined = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          return yield* fetchAndWrite()
        }),
      ).pipe(Effect.orElseSucceed(() => undefined))
      return fetched ?? {}
    }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.orDie)

    const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)

    const get = (): Effect.Effect<Record<string, Provider>> => cachedGet

    const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
      if (!force && (yield* fresh())) return
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          // Re-check under the lock: another process may have refreshed between
          // our outer check and lock acquisition.
          if (!force && (yield* fresh())) return
          yield* fetchAndWrite()
          yield* invalidate
          yield* events.publish(Event.Refreshed, {})
        }),
      ).pipe(
        Effect.tapCause((cause) =>
          Effect.sync(() => bootLog("models.dev.fetch", formatModelsDevFetchFailure(cause))),
        ),
        Effect.ignore,
      )
    })

    if (!Flag.SPINOSA_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
      // Schedule.spaced runs the effect once, then waits between completions.
      yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced("60 minutes")), Effect.ignore))
    }

    return Service.of({ get, refresh })
  }),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [FSUtil.node, EventV2.node, httpClient] })

/**
 * Embedded models.dev snapshot baked in at release-build time
 * (SPINOSA_MODELS_DEV define). Undefined in dev/source runs.
 * Lets `internal smoke provider-catalog` prove the shipped binary
 * carries a non-empty catalog without touching the network.
 */
export function embeddedModelsSnapshot(): Record<string, Provider> | undefined {
  if (typeof SPINOSA_MODELS_DEV === "undefined") return undefined
  return SPINOSA_MODELS_DEV
}

export * as ModelsDev from "./models-dev"
