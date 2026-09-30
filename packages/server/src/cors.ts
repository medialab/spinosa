import { Context } from "effect"

export type CorsOptions = { readonly cors?: ReadonlyArray<string> }

export type RequestHostPolicy = { readonly loopbackOnly: boolean }

export const CorsConfig = Context.Reference<CorsOptions | undefined>("@opencode/ServerCorsConfig", {
  defaultValue: () => undefined,
})

export function isAllowedCorsOrigin(input: string | undefined, opts?: CorsOptions) {
  if (!input) return true
  // Same-origin requests are allowed in `isAllowedRequestOrigin` via the host
  // match. For foreign cross-origin browser requests we deliberately do NOT
  // echo arbitrary `http://localhost:*` origins: any page running on localhost
  // (dev server, packaged app, malicious widget) would otherwise get CORS
  // access to this server's data (including workspace file reads).
  if (input.startsWith("oc://renderer")) return true
  if (input === "tauri://localhost" || input === "http://tauri.localhost" || input === "https://tauri.localhost")
    return true
  return opts?.cors?.includes(input) ?? false
}

export function isAllowedRequestOrigin(
  input: string | undefined,
  host: string | undefined,
  opts?: CorsOptions,
  hostPolicy?: RequestHostPolicy,
) {
  if (!input) return true
  if (!isAllowedRequestHost(host, hostPolicy)) return false
  if (host && sameHost(input, host)) return true
  return isAllowedCorsOrigin(input, opts)
}

export function isAllowedRequestHost(input: string | undefined, policy?: RequestHostPolicy) {
  if (!policy?.loopbackOnly) return true
  if (!input) return false

  try {
    const url = new URL(`http://${input}`)
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false
    return isLoopbackHostname(url.hostname)
  } catch {
    return false
  }
}

export function isLoopbackHostname(hostname: string) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  return (
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value === "::1" ||
    value === "::ffff:127.0.0.1" ||
    /^127(?:\.\d{1,3}){3}$/.test(value)
  )
}

function sameHost(origin: string, host: string) {
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
