const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"])
const devProtocols = new Set(["http:", "https:"])

export function desktopSidecarCorsOrigins(input: { packaged: boolean; rendererURL?: string }) {
  if (input.packaged) return ["oc://renderer"]
  if (!input.rendererURL) return []

  try {
    const renderer = new URL(input.rendererURL)
    if (!devProtocols.has(renderer.protocol) || !loopbackHosts.has(renderer.hostname)) return []
    return [renderer.origin]
  } catch {
    return []
  }
}
