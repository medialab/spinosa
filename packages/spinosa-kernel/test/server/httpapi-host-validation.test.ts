import { afterEach, describe, expect, test } from "bun:test"
import { request as httpRequest } from "node:http"
import { Flag } from "@spinosa/kernel-core/flag/flag"
import { Server } from "../../src/server/server"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

const original = {
  password: Flag.SPINOSA_SERVER_PASSWORD,
  username: Flag.SPINOSA_SERVER_USERNAME,
  envPassword: process.env.SPINOSA_SERVER_PASSWORD,
  envUsername: process.env.SPINOSA_SERVER_USERNAME,
}

afterEach(async () => {
  Flag.SPINOSA_SERVER_PASSWORD = original.password
  Flag.SPINOSA_SERVER_USERNAME = original.username
  if (original.envPassword === undefined) delete process.env.SPINOSA_SERVER_PASSWORD
  else process.env.SPINOSA_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.SPINOSA_SERVER_USERNAME
  else process.env.SPINOSA_SERVER_USERNAME = original.envUsername
  await disposeAllInstances()
  await resetDatabase()
})

function configureAuth(password?: string) {
  Flag.SPINOSA_SERVER_USERNAME = "opencode"
  process.env.SPINOSA_SERVER_USERNAME = "opencode"
  Flag.SPINOSA_SERVER_PASSWORD = password
  if (password === undefined) delete process.env.SPINOSA_SERVER_PASSWORD
  else process.env.SPINOSA_SERVER_PASSWORD = password
}

function request(listener: Awaited<ReturnType<typeof Server.listen>>, path: string, headers: Record<string, string>) {
  return new Promise<{
    status: number
    headers: Record<string, string | string[] | undefined>
  }>((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: listener.port,
        path,
        headers,
      },
      (response) => {
        response.resume()
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
          }),
        )
      },
    )
    req.once("upgrade", (_response, socket) => {
      socket.destroy()
      reject(new Error("request unexpectedly upgraded"))
    })
    req.once("error", reject)
    req.end()
  })
}

describe("HttpApi request Host validation", () => {
  test("rejects DNS-rebinding Host values before legacy, V2, and WebSocket routes", async () => {
    configureAuth()
    const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
    try {
      const authority = `attacker.example:${listener.port}`
      expect(
        (
          await request(listener, "/global/health", {
            host: authority,
            origin: `http://${authority}`,
          })
        ).status,
      ).toBe(421)
      expect((await request(listener, "/api/health", { host: authority })).status).toBe(421)

      const ptyPath = PtyPaths.connect.replace(":ptyID", "missing") + "?directory=%2Ftmp&cursor=-1"
      expect(
        (
          await request(listener, ptyPath, {
            host: authority,
            connection: "Upgrade",
            upgrade: "websocket",
            "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
            "sec-websocket-version": "13",
          })
        ).status,
      ).toBe(421)
    } finally {
      await listener.stop(true)
    }
  })

  test("accepts normal loopback Host forms without an Origin header", async () => {
    configureAuth()
    const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
    try {
      for (const host of [`localhost:${listener.port}`, `127.0.0.1:${listener.port}`, `[::1]:${listener.port}`]) {
        expect((await request(listener, "/global/health", { host })).status).toBe(200)
      }
    } finally {
      await listener.stop(true)
    }
  })

  test("preserves custom Host values for authenticated proxy deployments", async () => {
    configureAuth("secret")
    const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
    try {
      const response = await request(listener, "/global/health", {
        host: "proxy.example",
        origin: "https://proxy.example",
        authorization: `Basic ${btoa("opencode:secret")}`,
      })
      expect(response.status).toBe(200)
      expect(response.headers["access-control-allow-origin"]).toBe("https://proxy.example")
    } finally {
      await listener.stop(true)
    }
  })

  test("describes the transport risk for remote HTTP Basic authentication", () => {
    configureAuth("secret")
    expect(Server.insecureRemoteTransportWarning("0.0.0.0")).toContain(
      "Basic authentication over HTTP does not encrypt credentials or traffic",
    )
    expect(Server.insecureRemoteTransportWarning("127.0.0.1")).toBeUndefined()
  })
})
