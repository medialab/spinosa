export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.SPINOSA_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

/**
 * Thin shell: the kernel runs on Bun via `scripts/serve-bun-sidecar.ts`
 * spawned by `src/main/server.ts`. No plain-Node server bundle is built —
 * this is kept as a no-op so predev/prebuild imports keep working.
 */
export async function buildServerBundle() {
  console.log("Thin shell: skipping plain-Node server bundle (Bun sidecar needs no build)")
}
