#!/usr/bin/env bun
/**
 * Dev-only headless Spinosa server for app/desktop development
 * (`bun run serve-dev --port 4096`). Mirrors the sidecar runtime without
 * Electron. NOT for production (no packaging, no version pinning).
 */
import { Server } from "@spinosa/kernel/server/server"

const port = Number(process.env.SPINOSA_DEV_PORT ?? Bun.argv[2] ?? 4096)
if (!process.env.SPINOSA_SERVER_PASSWORD) {
  console.log("Warning: SPINOSA_SERVER_PASSWORD is not set; server is unsecured.")
}
const listener = await Server.listen({ port, hostname: "127.0.0.1" })
console.log(`spinosa dev server listening on ${listener.url}`)
process.on("SIGINT", () => listener.stop().then(() => process.exit(0)))
await new Promise(() => undefined)
