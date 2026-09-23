import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export type ServerProtocol = "v1" | "v2"

function headers(server: ServerConnection.HttpBase) {
  if (!server.password) return
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
  }
}

async function probe(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch, path: string) {
  const response = await fetch(new URL(path, server.url), {
    headers: headers(server),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") return
  return value
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<ServerProtocol> {
  const current = await probe(server, fetch, "/api/health").catch(() => undefined)
  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)

  const pid = current && typeof current === "object" && "pid" in current ? current.pid : undefined
  if (typeof pid === "number") {
    // Modern opencode serves /api with a pid; prefer the legacy contract only
    // when its endpoint is still healthy.
    if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"
    return "v2"
  }

  const legacyHealthy = !!legacy && "healthy" in legacy && legacy.healthy === true
  const currentHealthy = !!current && "healthy" in current && current.healthy === true
  // Spinosa serves both generations without a pid, but its source of truth is
  // the V1 conversation transport (the same one the TUI uses): V1 prompt
  // submission, V1 message projection, auth.json credentials, and the full
  // V1 provider catalog. Pin the desktop to V1 so every consumer reads one
  // protocol instead of mixing V1 writes with V2 reads.
  if (legacyHealthy && currentHealthy) return "v1"
  if (legacyHealthy) return "v1"
  if (currentHealthy) return "v1"
  return "v2"
}
