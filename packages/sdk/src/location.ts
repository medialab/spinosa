export type LocationValues = {
  readonly directory?: string
  readonly workspace?: string
}

type RewriteOptions = {
  /** Include workspace headers and query parameters (the v2 API surface). */
  readonly includeWorkspace?: boolean
  /** Mirror API locations into the generated `location[...]` query keys. */
  readonly includeApiLocationQueries?: boolean
}

function pick(
  value: string | null,
  fallback?: string,
  encode?: (value: string) => string,
) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (encode && value === encode(fallback)) return fallback
  return value
}

function decode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Move location headers into query parameters for GET/HEAD requests.
 *
 * The v1 and v2 generated clients share this transport rule but differ in
 * whether they carry a workspace and the v2 API's nested query aliases.
 */
export function rewriteLocationRequest(
  request: Request,
  values: LocationValues,
  options: RewriteOptions = {},
): Request {
  if (request.method !== "GET" && request.method !== "HEAD") return request

  const url = new URL(request.url)
  let changed = false
  const locations: Array<{
    readonly headers: readonly [string, string]
    readonly key: "directory" | "workspace"
    readonly value?: string
    readonly encoded: boolean
  }> = [
    {
      headers: ["x-spinosa-directory", "x-opencode-directory"],
      key: "directory",
      value: values.directory,
      encoded: true,
    },
  ]
  if (options.includeWorkspace) {
    locations.push({
      headers: ["x-spinosa-workspace", "x-opencode-workspace"],
      key: "workspace",
      value: values.workspace,
      encoded: false,
    })
  }

  for (const location of locations) {
    const value = pick(
      request.headers.get(location.headers[0]) ??
        request.headers.get(location.headers[1]),
      location.value,
      location.encoded ? encodeURIComponent : undefined,
    )
    if (!value) continue

    const queryValue = location.encoded ? decode(value) : value
    const queryKeys =
      options.includeApiLocationQueries && url.pathname.startsWith("/api/")
        ? [location.key, `location[${location.key}]`]
        : [location.key]
    for (const queryKey of queryKeys) {
      if (!url.searchParams.has(queryKey))
        url.searchParams.set(queryKey, queryValue)
    }
    changed = true
  }

  if (!changed) return request

  const next = new Request(url, request)
  for (const [spinosa, legacy] of locations.map(
    (location) => location.headers,
  )) {
    next.headers.delete(spinosa)
    next.headers.delete(legacy)
  }
  return next
}
