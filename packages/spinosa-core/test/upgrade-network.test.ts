import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { resolvePinnedVersionFromInstaller } from "../src/system/channels"

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("rolling channel installer fetch", () => {
  test("parses pinned version from mocked beta installer", async () => {
    server.use(
      http.get("https://example.test/beta/install.sh", () =>
        HttpResponse.text('#!/bin/sh\nPINNED_VERSION="1.0.2-beta.14"\n'),
      ),
    )

    await expect(resolvePinnedVersionFromInstaller("https://example.test/beta/install.sh"))
      .resolves.toBe("1.0.2-beta.14")
  })

  test("returns undefined when mocked installer is missing a pin", async () => {
    server.use(
      http.get("https://example.test/beta/install.sh", () =>
        HttpResponse.text("#!/bin/sh\n# no pin\n"),
      ),
    )

    await expect(resolvePinnedVersionFromInstaller("https://example.test/beta/install.sh"))
      .resolves.toBeUndefined()
  })

  test("refuses non-https installer URLs without fetching", async () => {
    await expect(resolvePinnedVersionFromInstaller("http://example.test/beta/install.sh"))
      .resolves.toBeUndefined()
    await expect(resolvePinnedVersionFromInstaller("file:///tmp/install.sh"))
      .resolves.toBeUndefined()
  })

  test("does not treat a stale beta pin as a successful fetch failure", async () => {
    server.use(
      http.get("https://example.test/beta/install.sh", () =>
        HttpResponse.text('PINNED_VERSION="1.0.2-beta.11"\n'),
      ),
    )

    const pinned = await resolvePinnedVersionFromInstaller("https://example.test/beta/install.sh")
    expect(pinned).toBe("1.0.2-beta.11")
    expect(pinned).not.toBe("1.0.2-beta.14")
  })
})
