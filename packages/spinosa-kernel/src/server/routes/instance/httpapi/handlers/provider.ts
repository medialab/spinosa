import { ProviderAuth } from "@/provider/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@spinosa/kernel-core/models-dev"
import { Provider } from "@/provider/provider"

import { mapValues } from "remeda"
import { Effect, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProviderAuthApiError, VisionTranscribeInput } from "../groups/provider"
import { ProviderV2 } from "@spinosa/kernel-core/provider"
import { ModelV2 } from "@spinosa/kernel-core/model"

/** Maximum time to wait for a vision provider response. */
export const VISION_PROVIDER_TIMEOUT_MS = 120_000

function mapProviderAuthError<A, R>(self: Effect.Effect<A, ProviderAuth.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof ProviderAuth.OauthMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCodeMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCallbackFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: {} })
      }
      if (error instanceof ProviderAuth.ValidationFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: { field: error.field, message: error.message } })
      }
      return new ProviderAuthApiError({ name: "BadRequest", data: {} })
    }),
  )
}

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      const config = yield* cfg.get()
      const all = yield* ModelsDev.Service.use((s) => s.get())
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
      const filtered: Record<string, (typeof all)[string]> = {}
      for (const [key, value] of Object.entries(all)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) filtered[key] = value
      }
      const connected = yield* provider.list()
      const providers = Object.assign(
        mapValues(filtered, (item) => Provider.fromModelsDevProvider(item)),
        connected,
      )
      return {
        all: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
        connected: Object.keys(connected),
      }
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      return yield* mapProviderAuthError(
        svc.authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          inputs: ctx.payload.inputs,
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
        Effect.mapError(() => new ProviderAuthApiError({ name: "BadRequest", data: {} })),
      )
      // Match legacy route behavior: when authorize() resolves without a
      // result (e.g. no further redirect), serialize as JSON `null` instead
      // of an empty body so clients can `.json()` parse the response.
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* mapProviderAuthError(
        svc.callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          code: ctx.payload.code,
        }),
      )
      // Same as auth.set: reload so newly authorized providers appear without
      // tearing down the instance (which wipes live session_status / busy UI).
      yield* provider.reload()
      return true
    })

    const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"])
    const MAX_BASE64_BYTES = 15 * 1024 * 1024
    const MAX_DECODED_BYTES = 10 * 1024 * 1024
    function isValidBase64(s: string): boolean {
      const trimmed = s.trim().replace(/\s+/g, "")
      if (trimmed.length === 0 || trimmed.length % 4 !== 0) return false
      return /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)
    }

    const visionTranscribe = Effect.fn("ProviderHttpApi.visionTranscribe")(function* (ctx: {
      params: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      payload: VisionTranscribeInput
    }) {
      const { providerID, modelID } = ctx.params
      const { prompt, image } = ctx.payload

      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        yield* Effect.logError("visionTranscribe BadRequest: missing prompt", { providerID, modelID })
        return yield* new ProviderAuthApiError({ name: "BadRequest", data: { message: "missing prompt" } })
      }
      if (!image || typeof image.mime !== "string" || typeof image.data !== "string") {
        yield* Effect.logError("visionTranscribe BadRequest: missing image", { providerID, modelID })
        return yield* new ProviderAuthApiError({ name: "BadRequest", data: { message: "missing image" } })
      }
      const mime = image.mime.toLowerCase()
      if (!ALLOWED_MIMES.has(mime)) {
        yield* Effect.logError("visionTranscribe BadRequest: mime not allowed", { providerID, modelID, mime })
        return yield* new ProviderAuthApiError({ name: "BadRequest", data: { message: `mime not allowed: ${mime}` } })
      }
      const data = image.data.trim()
      if (data.length === 0) {
        yield* Effect.logError("visionTranscribe BadRequest: empty data", { providerID, modelID })
        return yield* new ProviderAuthApiError({ name: "BadRequest", data: { message: "empty image data" } })
      }
      if (data.length > MAX_BASE64_BYTES) {
        yield* Effect.logError("visionTranscribe BadRequest: base64 too large", { providerID, modelID, len: data.length })
        return yield* new ProviderAuthApiError({ name: "BadRequest", data: { message: `base64 too large: ${data.length}` } })
      }
      if (!isValidBase64(data)) {
        yield* Effect.logError("visionTranscribe BadRequest: invalid base64", { providerID, modelID, len: data.length })
        return yield* new ProviderAuthApiError({ name: "BadRequest", data: { message: "invalid base64" } })
      }
      const decodedLen = Math.floor((data.length * 3) / 4)
      if (decodedLen > MAX_DECODED_BYTES) {
        yield* Effect.logError("visionTranscribe BadRequest: decoded too large", { providerID, modelID, decodedLen })
        return yield* new ProviderAuthApiError({ name: "BadRequest", data: { message: `decoded too large: ${decodedLen}` } })
      }

      const model = yield* provider.getModel(providerID, modelID).pipe(
        Effect.mapError((e) => {
          const tag = (e as { _tag?: string })?._tag ?? ""
          const msg = (e as { message?: string })?.message ?? String(e)
          if (tag === "ProviderModelNotFoundError") {
            Effect.runSync(Effect.logError("visionTranscribe model not found", { providerID, modelID, error: msg }))
            return new HttpApiError.NotFound({})
          }
          const causeMsg = (e as { cause?: unknown })?.cause ? String((e as { cause: unknown }).cause) : msg
          if (/401|403|unauthorized|authentication/i.test(causeMsg)) {
            Effect.runSync(Effect.logError("visionTranscribe model auth error", { providerID, modelID, error: causeMsg }))
            // Message-carrying shape (not bare Unauthorized) so the TUI can tell
            // bad-key apart from rate-limit/transient. "Unauthorized" stays in
            // the text for the regex matchers downstream.
            return new ProviderAuthApiError({ name: "BadRequest", data: { message: `Unauthorized resolving ${providerID}/${modelID}: ${causeMsg.slice(0, 300)}` } })
          }
          Effect.runSync(Effect.logError("visionTranscribe getModel BadRequest", { providerID, modelID, tag, error: msg }))
          return new ProviderAuthApiError({ name: "BadRequest", data: { message: `getModel failed: ${msg.slice(0, 300)}` } })
        }),
      )

      // Validate model is vision-capable and exists in catalog — prevents stale gpt-5.6 etc.
      const modelCaps = (model as unknown as { capabilities?: { input?: string[] | Record<string, boolean> }; input?: string[] })?.capabilities
        ?? (model as unknown as { input?: string[] })?.input
      const hasVision = (() => {
        if (!modelCaps) return true // allow if caps missing — let generateText decide, but log
        if (Array.isArray(modelCaps)) return false
        if (Array.isArray((modelCaps as { input?: unknown }).input)) return (modelCaps as { input: string[] }).input.includes("image")
        if (typeof modelCaps === "object" && "image" in (modelCaps as Record<string, unknown>)) return Boolean((modelCaps as Record<string, boolean>).image)
        return true
      })()
      if (!hasVision) {
        yield* Effect.logError("visionTranscribe model not vision-capable", { providerID, modelID, caps: modelCaps })
        return yield* new ProviderAuthApiError({ name: "BadRequest", data: { message: `model not vision-capable: ${modelID}` } })
      }

      const language = yield* provider.getLanguage(model).pipe(
        Effect.mapError((e) => {
          const tag = (e as { _tag?: string })?._tag ?? ""
          const msg = (e as { message?: string })?.message ?? String(e)
          const causeMsg = (e as { cause?: unknown })?.cause ? String((e as { cause: unknown }).cause) : msg
          if (tag === "ProviderInitError") {
            if (/401|403|unauthorized|authentication|invalid_api_key|Incorrect API key|insufficient permissions|Missing scopes|api\.responses\.write/i.test(causeMsg)) {
              Effect.runSync(Effect.logError("visionTranscribe init auth error", { providerID, modelID, error: causeMsg }))
              return new ProviderAuthApiError({ name: "BadRequest", data: { message: `Unauthorized initializing ${providerID}: ${causeMsg.slice(0, 300)}` } })
            }
            Effect.runSync(Effect.logError("visionTranscribe init BadRequest", { providerID, modelID, tag, error: causeMsg }))
            return new ProviderAuthApiError({ name: "BadRequest", data: { message: `init failed: ${causeMsg.slice(0, 300)}` } })
          }
          if (tag === "ProviderModelNotFoundError") {
            Effect.runSync(Effect.logError("visionTranscribe language model not found", { providerID, modelID, error: msg }))
            return new HttpApiError.NotFound({})
          }
          if (/401|403|unauthorized|authentication|invalid_api_key|Incorrect API key|insufficient permissions|Missing scopes|api\.responses\.write/i.test(msg)) {
            Effect.runSync(Effect.logError("visionTranscribe language auth error", { providerID, modelID, error: msg }))
            return new ProviderAuthApiError({ name: "BadRequest", data: { message: `Unauthorized loading ${providerID}/${modelID}: ${msg.slice(0, 300)}` } })
          }
          Effect.runSync(Effect.logError("visionTranscribe getLanguage BadRequest", { providerID, modelID, tag, error: msg }))
          return new ProviderAuthApiError({ name: "BadRequest", data: { message: `getLanguage failed: ${msg.slice(0, 300)}` } })
        }),
      )

      const text = yield* Effect.tryPromise({
        try: async () => {
          const { generateText } = await import("ai")
          const dataUrl = `data:${mime};base64,${data}`
          const controller = new AbortController()
          let timeoutId: ReturnType<typeof setTimeout> | undefined
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => {
                controller.abort()
                reject(new Error(`vision timeout after ${VISION_PROVIDER_TIMEOUT_MS / 1000}s`))
              },
              VISION_PROVIDER_TIMEOUT_MS,
            )
          })
          let result: unknown
          try {
            result = await Promise.race([
              (generateText as unknown as (opts: unknown) => Promise<unknown>)({
                model: language as unknown,
                abortSignal: controller.signal,
                messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image", image: dataUrl }] }],
              }),
              timeoutPromise,
            ])
          } finally {
            if (timeoutId) clearTimeout(timeoutId)
          }
          const cast = result as { text?: string }
          const t = cast?.text?.trim() ?? ""
          if (!t) throw new Error("Vision model returned no text")
          return t
        },
        catch: (cause) => cause as unknown,
      }).pipe(
        Effect.tapError((cause) => {
          const detail = (() => {
            if (!cause) return "empty"
            if (typeof cause === "string") return cause.slice(0, 2000)
            if (cause instanceof Error) {
              const parts = [cause.message]
              const c = cause as unknown as Record<string, unknown>
              if (c.cause) parts.push(`cause=${String(c.cause).slice(0, 800)}`)
              if (c.responseBody) parts.push(`body=${String(c.responseBody).slice(0, 1200)}`)
              if (c.data) try { parts.push(`data=${JSON.stringify(c.data).slice(0, 1200)}`) } catch {}
              if (c.lastError) parts.push(`last=${String(c.lastError).slice(0, 800)}`)
              // AI SDK APICallError nests last error in cause
              const nested = (c.cause as Record<string, unknown> | undefined)
              if (nested?.["responseBody"]) parts.push(`nestedBody=${String(nested["responseBody"]).slice(0, 1200)}`)
              return parts.join(" | ").slice(0, 2500)
            }
            try { return JSON.stringify(cause).slice(0, 2000) } catch { return String(cause).slice(0, 2000) }
          })()
          return Effect.logError("visionTranscribe generateText failed", { providerID, modelID, mime, promptLen: prompt.length, dataLen: data.length, error: detail, stack: cause instanceof Error ? cause.stack?.slice(0, 1200) : undefined })
        }),
        Effect.mapError((cause) => {
          if (cause && typeof cause === "object" && "_tag" in (cause as object)) {
            const tag = (cause as { _tag: string })._tag
            if (tag === "BadRequest" || tag === "Unauthorized" || tag === "NotFound" || tag === "ProviderAuthError") return cause as never
          }
          const msg = (() => {
            if (!cause) return "unknown"
            if (typeof cause === "string") return cause
            if (cause instanceof Error) {
              const parts = [cause.message]
              const c = cause as unknown as Record<string, unknown>
              if (c.cause) parts.push(String(c.cause))
              if (c.responseBody) parts.push(String(c.responseBody))
              if (c.data) try { parts.push(JSON.stringify(c.data)) } catch {}
              if (c.lastError) parts.push(String(c.lastError))
              const nested = c.cause as Record<string, unknown> | undefined
              if (nested?.["responseBody"]) parts.push(String(nested["responseBody"]))
              const joined = parts.join(" | ")
              return joined.length > 800 ? joined.slice(0, 800) : joined
            }
            try { return JSON.stringify(cause) } catch { return String(cause) }
          })()
          if (/401|403|unauthorized|authentication|invalid_api_key|Incorrect API key|insufficient permissions|Missing scopes|api\.responses\.write|Provider returned error|rate limit|credits/i.test(msg)) {
            // Auth failures keep the "Unauthorized" word in a message-carrying
            // shape (never bare) so the TUI can separate bad-key from
            // rate-limit/transient — only the former should push re-auth.
            if (/401|403|unauthorized|authentication|invalid_api_key|Incorrect API key|insufficient permissions|Missing scopes|api\.responses\.write/i.test(msg)) {
              return new ProviderAuthApiError({ name: "BadRequest", data: { message: `Unauthorized transcribing with ${providerID}/${modelID}: ${msg.slice(0, 500)}` } })
            }
            return new ProviderAuthApiError({ name: "BadRequest", data: { message: msg.slice(0, 800) } })
          }
          // Surface provider 400 with full message so TUI shows cause instead of empty BadRequest
          return new ProviderAuthApiError({ name: "BadRequest", data: { message: msg.slice(0, 800) } })
        }),
      )

      return { text }
    })

    return handlers
      .handle("list", list)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
      .handle("visionTranscribe", visionTranscribe)
  }),
)
