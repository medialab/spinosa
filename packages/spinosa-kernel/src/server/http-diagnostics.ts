import { randomUUID } from "node:crypto"
import {
  bootLog,
  bootLogError,
} from "@spinosa/kernel-core/observability/boot-log"

const REQUEST_ID_HEADER = "x-spinosa-request-id"
const RENDERER_ID_HEADER = "x-spinosa-renderer-id"
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const SLOW_REQUEST_MS = 1_000

export type HttpDiagnostic = {
  requestID: string
  rendererID?: string
  method: string
  path: string
  startedAt: number
}

function safeID(value: string | null) {
  return value && ID_PATTERN.test(value) ? value : undefined
}

function pathOf(request: Request) {
  try {
    return new URL(request.url).pathname
  } catch {
    return "$URL"
  }
}

export function httpDiagnostic(request: Request): HttpDiagnostic {
  return {
    requestID: safeID(request.headers.get(REQUEST_ID_HEADER)) ?? randomUUID(),
    rendererID: safeID(request.headers.get(RENDERER_ID_HEADER)),
    method: request.method,
    path: pathOf(request),
    startedAt: Date.now(),
  }
}

export function shouldLogHttpStart(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())
}

export function shouldLogHttpFinish(
  method: string,
  status: number,
  durationMs: number,
) {
  const normalized = method.toUpperCase()
  return (
    status >= 400 ||
    !["GET", "HEAD", "OPTIONS"].includes(normalized) ||
    durationMs >= SLOW_REQUEST_MS
  )
}

export function logHttpStart(diagnostic: HttpDiagnostic) {
  if (!shouldLogHttpStart(diagnostic.method)) return
  bootLog("http.request.start", "HTTP request started", {
    requestID: diagnostic.requestID,
    rendererID: diagnostic.rendererID,
    method: diagnostic.method,
    path: diagnostic.path,
  })
}

export function logHttpFinish(diagnostic: HttpDiagnostic, status: number) {
  const durationMs = Date.now() - diagnostic.startedAt
  if (!shouldLogHttpFinish(diagnostic.method, status, durationMs)) return
  bootLog("http.request.finish", "HTTP request finished", {
    requestID: diagnostic.requestID,
    rendererID: diagnostic.rendererID,
    method: diagnostic.method,
    path: diagnostic.path,
    status,
    durationMs,
  })
}

export function logHttpFailure(diagnostic: HttpDiagnostic, cause: unknown) {
  const durationMs = Date.now() - diagnostic.startedAt
  bootLogError(`http.request.error.${diagnostic.requestID}`, cause)
  bootLog("http.request.finish", "HTTP request failed", {
    requestID: diagnostic.requestID,
    rendererID: diagnostic.rendererID,
    method: diagnostic.method,
    path: diagnostic.path,
    status: 500,
    durationMs,
  })
}

export const httpDiagnosticHeaders = {
  requestID: REQUEST_ID_HEADER,
  rendererID: RENDERER_ID_HEADER,
} as const
