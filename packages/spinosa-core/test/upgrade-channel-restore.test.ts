// Beta-track invariants for `upgradeFramework`:
//   1. the `beta: true` repair is keyed on "the installer ran", not on "the
//      upgrade succeeded" — a mid-flight failure must not silently move a beta
//      user onto the stable track;
//   2. the no-argument command shares one definition of "newer" with the launch
//      probe, so it cannot answer "Refusing to downgrade" while launch says
//      "No updates available".
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { upgradeFramework } from "../src/commands/upgrade"

const VERSION = "9.9.9-test"
const RELEASE = `https://github.com/medialab/spinosa/releases/download`
const INSTALL_URL = `${RELEASE}/v${VERSION}/install.sh`
const CHECKSUM_URL = `${RELEASE}/v${VERSION}/checksums.txt`
const BETA_CHANNEL_URL = `${RELEASE}/beta/install.sh`
const STABLE_CHANNEL_URL = `${RELEASE}/stable/install.sh`

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function checksumFor(script: string): string {
  return `${createHash("sha256").update(script).digest("hex")}  install.sh\n`
}

/** Temporary $SPINOSA_HOME that looks like a binary install on the beta track. */
function betaHome(input: { installedVersion: string }) {
  const home = path.join(
    process.env.TMPDIR ?? "/tmp",
    `spinosa-channel-restore-${process.pid}-${crypto.randomUUID()}`,
  )
  mkdirSync(path.join(home, "bin"), { recursive: true })
  mkdirSync(path.join(home, "metadata"), { recursive: true })
  writeFileSync(path.join(home, "bin", "spinosa"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  const configPath = path.join(home, "metadata", "config.yaml")
  writeFileSync(configPath, `beta: true\nlast_installed_version: ${input.installedVersion}\n`)

  const previous = { home: process.env.SPINOSA_HOME, metadata: process.env.SPINOSA_METADATA_DIR }
  process.env.SPINOSA_HOME = home
  process.env.SPINOSA_METADATA_DIR = path.join(home, "metadata")

  return {
    configPath,
    config: () => readFileSync(configPath, "utf-8"),
    restore: () => {
      if (previous.home === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = previous.home
      if (previous.metadata === undefined) delete process.env.SPINOSA_METADATA_DIR
      else process.env.SPINOSA_METADATA_DIR = previous.metadata
      rmSync(home, { recursive: true, force: true })
    },
  }
}

describe("beta channel restore", () => {
  test("keeps beta: true when the post-install version check fails", async () => {
    // Stands in for install.sh writing `beta:` from PINNED_TAG, then the
    // upgrade failing before it can report a matching version.
    const installer = [
      "#!/bin/bash",
      'printf "beta: false\\nlast_installed_version: 1.2.1\\n" > "$SPINOSA_METADATA_DIR/config.yaml"',
      "exit 0",
      "",
    ].join("\n")
    server.use(
      http.get(INSTALL_URL, () => HttpResponse.text(installer)),
      http.get(CHECKSUM_URL, () => HttpResponse.text(checksumFor(installer))),
    )

    const home = betaHome({ installedVersion: "1.2.0-beta.12" })
    try {
      const result = await upgradeFramework({
        version: VERSION,
        yes: true,
        allowDowngrade: true,
        suppressInstallOutput: true,
      })

      // The upgrade genuinely failed: the installed version never became VERSION.
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Post-install version mismatch/i)
      // ...and the user is still on the beta track.
      expect(home.config()).toMatch(/^beta:\s*true\s*$/m)
    } finally {
      home.restore()
    }
  }, 30000)
})

describe("upgrade command target resolution", () => {
  test("reports already-current instead of refusing to downgrade to the beta pin", async () => {
    // A beta user who accepted a newer stable sits ahead of the rolling beta pin.
    server.use(
      http.get(BETA_CHANNEL_URL, () => HttpResponse.text('PINNED_VERSION="1.2.0-beta.12"\n')),
      http.get(STABLE_CHANNEL_URL, () => HttpResponse.text('PINNED_VERSION="1.2.1"\n')),
    )

    const home = betaHome({ installedVersion: "1.2.1" })
    try {
      const phases: string[] = []
      const result = await upgradeFramework({
        yes: true,
        check: true,
        suppressInstallOutput: true,
        onPhase: (phase) => phases.push(phase),
      })

      expect(result.success).toBe(true)
      expect(result.refusedReason).toBeUndefined()
      expect(result.newVersion).toBe("1.2.1")
      expect(phases).toContain("current")
      expect(phases).not.toContain("refused")
    } finally {
      home.restore()
    }
  }, 30000)

  test("still offers a newer beta pin on a beta home", async () => {
    server.use(
      http.get(BETA_CHANNEL_URL, () => HttpResponse.text('PINNED_VERSION="1.2.0-beta.13"\n')),
      http.get(STABLE_CHANNEL_URL, () => HttpResponse.text('PINNED_VERSION="1.2.0"\n')),
    )

    const home = betaHome({ installedVersion: "1.2.0-beta.12" })
    try {
      const result = await upgradeFramework({ yes: true, check: true, suppressInstallOutput: true })
      expect(result.success).toBe(true)
      expect(result.newVersion).toBe("1.2.0-beta.13")
    } finally {
      home.restore()
    }
  }, 30000)
})
