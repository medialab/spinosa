#!/usr/bin/env bun
/**
 * Binary-distribution quality gate (`bun run quality:binary`).
 *
 * 1. Distribution + release-path unit tests
 * 2. Installer bats
 * 3. Host-only product binary build (embedded templates)
 * 4. Smoke host binary when present (version/doctor)
 */
import { $ } from "bun"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { productBinaryAssetName, resolveProductBinaryTarget } from "../packages/spinosa-core/src/distribution/contract.ts"

const root = path.resolve(import.meta.dir, "..")
const version = (
  JSON.parse(await Bun.file(path.join(root, "package.json")).text()) as { version: string }
).version
const channel = version.includes("-") ? "beta" : "stable"
const outDir = path.join(root, `dist/v${version}`)

const forbiddenPersonalMarkers = [
  Buffer.from("tommasoprinetti"),
  Buffer.from("thdxr"),
]

function assertPortableBinary(binaryPath: string): void {
  // Release binaries must never carry a maintainer username — but the binary
  // is never rewritten to hide it (beta.18/beta.19 outage), so local builds
  // on a personal checkout warn while CI (runner paths) fails closed.
  const strict = Boolean(process.env.CI || process.env.GITHUB_ACTIONS)
  const bytes = readFileSync(binaryPath)
  for (const marker of forbiddenPersonalMarkers) {
    const offset = bytes.indexOf(marker)
    if (offset >= 0) {
      const message = `binary ${binaryPath} contains forbidden personal marker ${marker.toString()} at byte ${offset}`
      if (strict) throw new Error(message)
      console.warn(`warning: ${message} (local build only — CI release gates fail closed)`)
      break
    }
  }
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  const started = performance.now()
  console.log(`→ ${label}`)
  await fn()
  console.log(`✓ ${label} (${Math.round(performance.now() - started)}ms)`)
}

await step("distribution + release unit tests", async () => {
  const result = await $`bun test --timeout 30000 test/distribution.test.ts test/distribution-tools.test.ts test/pdf-engine.test.ts test/pdf-scanned-ocr.test.ts test/manifest-partial.test.ts test/destinations.test.ts test/zip-hardened.test.ts test/vision-abort.test.ts test/standalone.test.ts test/uninstall.test.ts ../../scripts/release/lib.test.ts ../../scripts/release/bump.test.ts ../../scripts/release/tools-build.test.ts ../../scripts/set-version.test.ts`
    .cwd(path.join(root, "packages/spinosa-core"))
    .nothrow()
  if (result.exitCode !== 0) throw new Error("binary unit tests failed")
})

await step("installer bats", async () => {
  const result = await $`bun run test:installer`.cwd(root).nothrow()
  if (result.exitCode !== 0) throw new Error("installer bats failed")
})

await step("host product binary build", async () => {
  const result =
    await $`bun scripts/build-release-binaries.ts --out-dir ${outDir} --version ${version} --channel ${channel} --host-only`
      .cwd(root)
      .nothrow()
  if (result.exitCode !== 0) throw new Error("host binary build failed")
})

const hostTarget = resolveProductBinaryTarget({ os: process.platform, arch: process.arch })
const hostAsset = productBinaryAssetName(hostTarget)
const hostBinary = path.join(outDir, hostAsset)

await step("host binary smoke", async () => {
  if (!existsSync(hostBinary)) throw new Error(`missing host binary ${hostBinary}`)
  assertPortableBinary(hostBinary)
  // Local OCR was removed: doctor must pass standalone with no tools
  // tarball and no SPINOSA_DEV_HOST_TOOLS override (fail closed).
  const result = await $`bun scripts/smoke-install.ts --binary ${hostBinary}`.cwd(root).nothrow()
  // Release gates fail closed: smoke failures are always fatal (no
  // SPINOSA_BINARY_SMOKE_STRICT escape hatch).
  if (result.exitCode !== 0) {
    throw new Error("host binary smoke failed (fail closed — release gate)")
  }
})

console.log(`✓ quality:binary passed (host=${hostAsset})`)
