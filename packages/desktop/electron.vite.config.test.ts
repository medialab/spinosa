import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

test("keeps generated app and desktop outputs out of the renderer watcher", async () => {
  const module = await import(`./electron.vite.config.ts?watch=${Date.now()}`)
  const ignored = module.default.renderer?.server?.watch?.ignored

  expect(ignored).toEqual([
    fileURLToPath(new URL("../app/dist", import.meta.url)),
    fileURLToPath(new URL("./out", import.meta.url)),
  ])
})

test("loads the credentialed Sentry plugin through the Node-compatible entrypoint", async () => {
  const previous = {
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
  }

  try {
    process.env.SENTRY_AUTH_TOKEN = "local-probe"
    process.env.SENTRY_ORG = "local-probe"
    process.env.SENTRY_PROJECT = "local-probe"

    const module = await import(`./electron.vite.config.ts?credentialed=${Date.now()}`)
    expect(Array.isArray(module.default.renderer?.plugins?.[1])).toBe(true)
  } finally {
    if (previous.authToken === undefined) delete process.env.SENTRY_AUTH_TOKEN
    else process.env.SENTRY_AUTH_TOKEN = previous.authToken
    if (previous.org === undefined) delete process.env.SENTRY_ORG
    else process.env.SENTRY_ORG = previous.org
    if (previous.project === undefined) delete process.env.SENTRY_PROJECT
    else process.env.SENTRY_PROJECT = previous.project
  }
})
