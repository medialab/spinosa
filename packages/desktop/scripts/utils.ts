import { $ } from "bun"

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.SPINOSA_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

/**
 * Build the embedded Spinosa kernel server bundle consumed by the Electron
 * sidecar (`virtual:spinosa-server` in `electron.vite.config.ts`). Replaces
 * the opencode `build-node` + CLI-download steps: the desktop always embeds
 * the kernel, there is no separate CLI binary to fetch.
 */
export async function buildServerBundle() {
  await $`bun ./scripts/build-server.ts`
}
