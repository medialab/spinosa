export function sdkResponseData<T>(response: unknown): T | undefined {
  if (response === undefined || response === null) return undefined
  if (typeof response === "object" && "data" in response) return response.data as T | undefined
  return response as T
}
