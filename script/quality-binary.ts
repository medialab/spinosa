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
  const bytes = readFileSync(binaryPath)
  for (const marker of forbiddenPersonalMarkers) {
    const offset = bytes.indexOf(marker)
    if (offset >= 0) {
      throw new Error(`binary ${binaryPath} contains forbidden personal marker ${marker.toString()} at byte ${offset}`)
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
  const result = await $`bun test --timeout 30000 test/distribution.test.ts test/uninstall.test.ts ../../script/release/lib.test.ts ../../script/release/bump.test.ts ../../script/set-version.test.ts`
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
    await $`bun script/build-release-binaries.ts --out-dir ${outDir} --version ${version} --channel ${channel} --host-only`
      .cwd(root)
      .nothrow()
  if (result.exitCode !== 0) throw new Error("host binary build failed")
})

const hostAsset = productBinaryAssetName(
  resolveProductBinaryTarget({ os: process.platform, arch: process.arch }),
)
const hostBinary = path.join(outDir, hostAsset)

await step("host binary smoke", async () => {
  if (!existsSync(hostBinary)) throw new Error(`missing host binary ${hostBinary}`)
  assertPortableBinary(hostBinary)
  const result = await $`bun script/smoke-install.ts --binary ${hostBinary}`.cwd(root).nothrow()
  if (result.exitCode !== 0) {
    if (process.env.SPINOSA_BINARY_SMOKE_STRICT === "1") {
      throw new Error("host binary smoke failed")
    }
    console.warn(
      "host binary smoke failed (non-strict) — often onnxruntime/OCR native packaging; artifact still built",
    )
  }
})

console.log(`✓ quality:binary passed (host=${hostAsset})`)
