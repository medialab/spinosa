import { Server } from "@/server/server"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { Config } from "@/config/config"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { publishJobEvent } from "@/job/bus"
import type { JobEvent } from "@spinosa/core/progress/job-event"
import { ServerAuth } from "@/server/auth"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { bootLog } from "@spinosa/kernel-core/observability/boot-log"

const onGlobalEvent = (event: GlobalEvent) => {
  Rpc.emit("global.event", event)
}
GlobalBus.on("event", onGlobalEvent)

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

export async function handleFetch(input: {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}) {
  const headers = { ...input.headers }
  const auth = ServerAuth.header()
  if (auth && !headers["authorization"] && !headers["Authorization"]) {
    headers["Authorization"] = auth
  }
  const request = new Request(input.url, {
    method: input.method,
    headers,
    body: input.body,
  })
  bootLog("worker.fetch", "proxying fetch", { method: input.method })
  const response = await Server.Default().app.fetch(request)
  const body = await response.text()
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  }
}

export async function startServer(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
  if (server) await server.stop(true)
  bootLog("worker.server", "starting server", { port: input.port, hostname: input.hostname })
  server = await Server.listen(input)
  const url = server.url.toString()
  bootLog("worker.server.running", "server is listening", { url })
  return { url }
}

export async function checkUpgrade(input: { directory: string }) {
  bootLog("worker.checkUpgrade", "loading instance", { directory: input.directory })
  try {
    await InstanceRuntime.load({ directory: input.directory })
  } catch (e) {
    bootLog("worker.checkUpgrade.load.error", "InstanceRuntime.load failed", { error: String(e) })
  }
}

export function emitJobEvent(input: { directory?: string; workspace?: string; event: JobEvent }) {
  publishJobEvent(input)
}

export async function reload() {
  await AppRuntime.runPromise(
    Effect.gen(function* () {
      const cfg = yield* Config.Service
      yield* cfg.invalidate()
      yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
    }),
  )
}

export async function shutdown() {
  await InstanceRuntime.disposeAllInstances()
  if (server) await server.stop(true)
  GlobalBus.off("event", onGlobalEvent)
}
