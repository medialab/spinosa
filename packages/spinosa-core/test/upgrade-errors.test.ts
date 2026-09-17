import { createHash } from "node:crypto"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { upgradeFramework, verifyInstallerChecksum } from "../src/commands/upgrade"

const INSTALLER = "#!/bin/bash\necho ok\n"
const CHECKSUM_OK = `${createHash("sha256").update(INSTALLER).digest("hex")}  install.sh\n`
const CHECKSUM_EXECUTABLE = `${createHash("sha256").update(INSTALLER).digest("hex")} *install.sh\n`
const CHECKSUM_BAD = `${"0".repeat(64)}  install.sh\n`
const VERSION = "9.9.9-test"
const INSTALL_URL = `https://github.com/medialab/spinosa/releases/download/v${VERSION}/install.sh`
const CHECKSUM_URL = `https://github.com/medialab/spinosa/releases/download/v${VERSION}/checksums.txt`

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("verifyInstallerChecksum", () => {
  test("accepts a matching sha256 for install.sh", () => {
    expect(verifyInstallerChecksum(INSTALLER, CHECKSUM_OK)).toBe(true)
  })

  test("accepts executable-style checksum paths", () => {
    expect(verifyInstallerChecksum(INSTALLER, CHECKSUM_EXECUTABLE)).toBe(true)
  })

  test("rejects a mismatched sha256", () => {
    expect(verifyInstallerChecksum(INSTALLER, CHECKSUM_BAD)).toBe(false)
  })
})

describe("upgradeFramework error reporting", () => {
  test("returns a useful error when the installer download fails", async () => {
    server.use(
      http.get(INSTALL_URL, () => new HttpResponse("missing", { status: 404 })),
      http.get(CHECKSUM_URL, () => HttpResponse.text(CHECKSUM_OK)),
    )

    const prevHome = process.env.SPINOSA_HOME
    process.env.SPINOSA_HOME = `${process.env.TMPDIR ?? "/tmp"}/spinosa-upgrade-err-${process.pid}`
    try {
      const result = await upgradeFramework({
        version: VERSION,
        channel: "beta",
        yes: true,
        allowDowngrade: true,
        suppressInstallOutput: true,
      })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Failed to download installer or checksums/i)
    } finally {
      if (prevHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = prevHome
    }
  })

  test("returns a useful error when the installer checksum mismatches", async () => {
    server.use(
      http.get(INSTALL_URL, () => HttpResponse.text(INSTALLER)),
      http.get(CHECKSUM_URL, () => HttpResponse.text(CHECKSUM_BAD)),
    )

    const prevHome = process.env.SPINOSA_HOME
    process.env.SPINOSA_HOME = `${process.env.TMPDIR ?? "/tmp"}/spinosa-upgrade-err-${process.pid}`
    try {
      const result = await upgradeFramework({
        version: VERSION,
        channel: "beta",
        yes: true,
        allowDowngrade: true,
        suppressInstallOutput: true,
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe("Installer checksum verification failed")
    } finally {
      if (prevHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = prevHome
    }
  })
})
