#!/usr/bin/env bun
/**
 * Thin release adapter: pack templates, compile four product binaries into dist/v{VERSION}/.
 *
 * Flags (used by scripts/release/stages.ts):
 *   --out-dir <dir> --version <ver> --channel <beta|stable> [--template-pack-id <id>]
 *   --host-only  --skip-install
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { $ } from "bun"
import {
  PRODUCT_BINARY_TARGETS,
  buildManifestAssets,
  type BuildManifest,
  type ProductBinaryTarget,
} from "../packages/spinosa-core/src/distribution/contract.ts"
import { releaseChannel } from "../packages/spinosa-core/src/utils/version.ts"
import {
  buildSpinosaBinaries,
  type BinaryTarget,
} from "../packages/spinosa-kernel/script/build.ts"

const root = path.resolve(import.meta.dir, "..")

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i < 0) return undefined
  return process.argv[i + 1]
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage:
  bun scripts/build-release-binaries.ts --out-dir <dir> --version <ver> --channel <stable|beta>
  [--host-only] [--only linux-x64[,darwin-arm64,...]] [--skip-install]`)
  process.exit(0)
}

const version =
  argValue("--version") ??
  (JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as { version: string }).version
const channel =
  (argValue("--channel") as "beta" | "stable" | undefined) ?? releaseChannel(version)
// Resolve absolutely: buildSpinosaBinaries process.chdir()'s into the kernel
// package, so a relative --out-dir would silently write under packages/spinosa-kernel/.
const outDir = path.resolve(
  root,
  argValue("--out-dir") ?? argValue("--out") ?? path.join(root, `dist/v${version}`),
)
const hostOnly = process.argv.includes("--host-only")
const skipInstall = process.argv.includes("--skip-install")
const onlyRaw = argValue("--only")
const onlyTargets = onlyRaw
  ? onlyRaw.split(",").map((s) => s.trim()).filter(Boolean)
  : null

if (channel !== "stable" && channel !== "beta") {
  console.error(`--channel must be stable|beta (got ${channel})`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

console.log(`→ packing workspace template for v${version}`)
await $`bun scripts/pack-workspace-template.ts --version ${version}`.cwd(root)
const packMetaPath = path.join(root, "packages/spinosa-kernel/src/generated/template-pack-meta.json")
const packModulePath = path.join(root, "packages/spinosa-kernel/src/generated/template-pack.gen.ts")
if (!existsSync(packMetaPath) || !existsSync(packModulePath)) {
  throw new Error("template pack generation failed")
}
const packMeta = JSON.parse(readFileSync(packMetaPath, "utf-8")) as {
  packId: string
  version: string
}
const templatePackModule = readFileSync(packModulePath, "utf-8")
const templatePackId = argValue("--template-pack-id") ?? packMeta.packId

const wanted = new Set(
  hostOnly
    ? ([`${process.platform}-${process.arch}`] as string[])
    : onlyTargets
      ? onlyTargets
      : (PRODUCT_BINARY_TARGETS as readonly string[]),
)

if (onlyTargets) {
  for (const t of onlyTargets) {
    if (!(PRODUCT_BINARY_TARGETS as readonly string[]).includes(t as ProductBinaryTarget)) {
      throw new Error(`--only unknown target: ${t} (want one of ${PRODUCT_BINARY_TARGETS.join(", ")})`)
    }
  }
}

const targets: BinaryTarget[] = PRODUCT_BINARY_TARGETS.filter((t) => wanted.has(t)).map((t) => {
  const [os, arch] = t.split("-") as ["darwin" | "linux", "arm64" | "x64"]
  return { os, arch }
})

if (targets.length === 0) {
  throw new Error(
    `no binary targets matched (hostOnly=${hostOnly}, platform=${process.platform}-${process.arch})`,
  )
}

console.log(`→ compiling ${targets.map((t) => `${t.os}-${t.arch}`).join(", ")} via buildSpinosaBinaries`)
const { assets } = await buildSpinosaBinaries({
  cwd: path.join(root, "packages/spinosa-kernel"),
  targets,
  version,
  channel,
  distribution: "binary",
  templatePackId,
  templatePackVersion: packMeta.version,
  flatOutDir: outDir,
  skipInstall,
  templatePackModule,
  smokeHost: true,
})

const manifest: BuildManifest = {
  product: "spinosa",
  version,
  channel,
  templatePackId,
  assets: buildManifestAssets(),
}
writeFileSync(path.join(outDir, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`✓ binaries → ${outDir}`)
for (const [name, file] of Object.entries(assets)) {
  console.log(`  ${name}: ${file}`)
}

for (const target of PRODUCT_BINARY_TARGETS) {
  if (!wanted.has(target)) continue
  const name = `spinosa-${target}`
  if (!existsSync(path.join(outDir, name))) {
    throw new Error(`missing product binary ${name}`)
  }
}

export type { ProductBinaryTarget }
