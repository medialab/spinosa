import path from "node:path"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { HttpServerRequest } from "effect/unstable/http"
import { bootLog, bootLogError } from "@spinosa/kernel-core/observability/boot-log"
import { EffectBridge } from "@/effect/bridge"
import { Provider } from "@/provider/provider"
import { InstanceHttpApi } from "../api"
import {
  cancelOnboardingJob,
  cancelOnboardingScan,
  checkOnboardingTools,
  createProviderVisionTranscriber,
  getActiveOnboardingJob,
  getOnboardingJob,
  getOnboardingScanProgress,
  previewOnboarding,
  resolveOnboardingJobAction,
  repairOnboardingTools,
  startOnboardingJob,
} from "../onboarding-service"

function requestID(request: HttpServerRequest.HttpServerRequest) {
  const value = request.headers["x-spinosa-request-id"]
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : crypto.randomUUID()
}

function logRejected(endpoint: string, id: string, reason: string) {
  bootLog("onboarding.http.rejected", "Onboarding request rejected", { endpoint, requestID: id, reason })
}

function mapRequestError(endpoint: string, id: string, cause: unknown) {
  bootLogError(`onboarding.http.error.${id}`, cause)
  bootLog("onboarding.http.failure", "Onboarding request failed", { endpoint, requestID: id })
  return new HttpApiError.BadRequest({})
}

export const onboardingHandlers = HttpApiBuilder.group(InstanceHttpApi, "onboarding", (handlers) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const bridge = yield* EffectBridge.make()

    const preview = Effect.fn("OnboardingHttpApi.preview")(function* (ctx) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const id = requestID(request)
      if (!ctx.query.directory || path.resolve(ctx.query.directory) !== path.resolve(ctx.payload.sourcePaths[0] ?? "")) {
        logRejected("preview", id, "routed directory does not match primary source")
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* Effect.tryPromise({
        try: () => previewOnboarding(ctx.payload.sourcePaths, ctx.payload.scanID, id),
        catch: (cause) => mapRequestError("preview", id, cause),
      })
    })

    const scan = Effect.fn("OnboardingHttpApi.scan")(function* (ctx) {
      const result = getOnboardingScanProgress(ctx.params.scanID, ctx.query.directory)
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    const cancelScan = Effect.fn("OnboardingHttpApi.cancelScan")(function* (ctx) {
      const result = cancelOnboardingScan(ctx.params.scanID, ctx.query.directory)
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    const tools = Effect.fn("OnboardingHttpApi.tools")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const id = requestID(request)
      return yield* Effect.tryPromise({
        try: () => checkOnboardingTools(),
        catch: (cause) => mapRequestError("tools", id, cause),
      })
    })

    const repairTools = Effect.fn("OnboardingHttpApi.repairTools")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const id = requestID(request)
      return yield* Effect.tryPromise({
        try: () => repairOnboardingTools(),
        catch: (cause) => mapRequestError("repairTools", id, cause),
      })
    })

    const start = Effect.fn("OnboardingHttpApi.start")(function* (ctx) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const id = requestID(request)
      const directory = ctx.query.directory
      if (!directory) {
        logRejected("start", id, "missing routed directory")
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* Effect.tryPromise({
        try: () => startOnboardingJob(
          ctx.payload,
          directory,
          createProviderVisionTranscriber(provider, bridge),
          { requestID: id },
        ),
        catch: (cause) => mapRequestError("start", id, cause),
      })
    })

    const job = Effect.fn("OnboardingHttpApi.job")(function* (ctx) {
      const result = getOnboardingJob(ctx.params.jobID, ctx.query.directory)
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    const active = Effect.fn("OnboardingHttpApi.active")(function* (ctx) {
      const result = getActiveOnboardingJob(ctx.query.directory)
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    const action = Effect.fn("OnboardingHttpApi.action")(function* (ctx) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const result = resolveOnboardingJobAction(
        ctx.params.jobID,
        ctx.payload.action,
        ctx.query.directory,
        ctx.payload.visionModelId,
        requestID(request),
      )
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    const cancel = Effect.fn("OnboardingHttpApi.cancel")(function* (ctx) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const result = cancelOnboardingJob(ctx.params.jobID, ctx.query.directory, requestID(request))
      if (!result) return yield* new HttpApiError.NotFound({})
      return result
    })

    return handlers
      .handle("tools", tools)
      .handle("repairTools", repairTools)
      .handle("preview", preview)
      .handle("scan", scan)
      .handle("cancelScan", cancelScan)
      .handle("start", start)
      .handle("active", active)
      .handle("job", job)
      .handle("action", action)
      .handle("cancel", cancel)
  }),
)
