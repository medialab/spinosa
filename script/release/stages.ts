import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, chmodSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { $ } from "bun"
import {
  buildManifestAssets,
  expectedChannelReleaseAssets,
  expectedImmutableReleaseAssets,
  productBinaryAssetName,
  resolveProductBinaryTarget,
  type BuildManifest,
  type ProductBinaryTarget,
} from "../../packages/spinosa-core/src/distribution/contract.ts"
import { parseInstallPinnedVersion } from "../../packages/spinosa-core/src/utils/version.ts"
import { syncProductVersion, assertChangelogHasVersion } from "../set-version.ts"
import { assertRollingChannelInstaller, publishRollingChannelRelease } from "./github.ts"
import { RELEASE_ROOT, releasePaths, type ReleasePaths } from "./lib.ts"
import type { Reporter } from "./reporter.ts"
import { markStage, writeState, type ReleaseState, type StageName } from "./state.ts"

export interface StageContext {
  version: string
  paths: ReleasePaths
  dryRun: boolean
  reporter: Reporter
  state: ReleaseState
  skipBump: boolean
}

/** Resolve GitHub auth into the process env. Never logs or persists the token. */
export async function resolveGhToken(): Promise<void> {
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return
  const result = await $`gh auth token`.quiet().nothrow()
  if (result.exitCode === 0) {
    process.env.GH_TOKEN = result.text().trim()
    return
  }
  throw new Error("GitHub auth required. Run: export GH_TOKEN=$(gh auth token)")
}

export async function runPreflight(ctx: StageContext): Promise<void> {
  const rawBranch = (await $`git branch --show-current`.text()).trim()
    || (await $`git rev-parse --abbrev-ref HEAD`.text()).trim()
  const branch = rawBranch.replace(/^heads\//, "")
  if (branch !== "main" && branch !== "beta-dev") {
    throw new Error(`releases must be cut from main or beta-dev (current: ${branch})`)
  }
  const expectedBranch = ctx.paths.channel === "stable" ? "main" : "beta-dev"
  if (branch !== expectedBranch) {
    throw new Error(
      `${ctx.paths.channel} releases must run from ${expectedBranch} (current: ${branch})`,
    )
  }
  ctx.reporter.detail(`branch ${branch} (${ctx.paths.channel})`)

  assertChangelogHasVersion(RELEASE_ROOT, ctx.version)
  ctx.reporter.detail(`CHANGELOG has section for v${ctx.version}`)

  const dirty = (await $`git status --porcelain`.text()).trim()
  if (dirty && !ctx.dryRun) throw new Error("working tree not clean — commit first")
  ctx.reporter.detail(ctx.dryRun && dirty ? "working tree dirty (ignored in dry-run)" : "working tree clean")

  if (ctx.dryRun) {
    ctx.reporter.detail("would run bun run quality")
    return
  }

  const result = await $`bun run quality`.cwd(RELEASE_ROOT).nothrow()
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1)
  ctx.reporter.detail("quality checks passed")
}

export async function runBump(ctx: StageContext): Promise<string> {
  if (ctx.skipBump) {
    ctx.reporter.detail(`using existing v${ctx.version}`)
    return ctx.version
  }

  if (ctx.dryRun) {
    ctx.reporter.detail(`would sync version files to v${ctx.version}`)
    ctx.reporter.detail(`would commit and push release: v${ctx.version}`)
    return ctx.version
  }

  const { previous, syncedPackages } = syncProductVersion(ctx.version, RELEASE_ROOT)
  ctx.reporter.detail(`${previous} → ${ctx.version}`)
  if (syncedPackages.length > 0) {
    ctx.reporter.detail(`synced packages: ${syncedPackages.join(", ")}`)
  }

  // Version bumps rewrite workspace package.json versions; refresh bun.lock so
  // user installs with `bun install --frozen-lockfile` succeed.
  const lock = await $`bun install`.cwd(RELEASE_ROOT).nothrow()
  if (lock.exitCode !== 0) {
    throw new Error("bun install failed after version sync — lockfile not refreshed")
  }
  ctx.reporter.detail("bun.lock refreshed for frozen installs")

  // Root + installer are source of truth; product packages (spinosa-core/cli/…) are synced too.
  // Kernel/tui stay on their own 1.17.x fork versions — see script/set-version.ts.
  const versionPaths = [
    "package.json",
    "install.sh",
    "bun.lock",
    ...syncedPackages.map((dir) => `${dir}/package.json`),
  ]
  const dirty = await $`git status --porcelain ${versionPaths}`.cwd(RELEASE_ROOT).text()
  if (dirty.trim()) {
    await $`git add ${versionPaths}`.cwd(RELEASE_ROOT)
    await $`git commit -m ${`release: v${ctx.version}`}`.cwd(RELEASE_ROOT)
    // Push the current branch tip by SHA-backed HEAD, but name the destination
    // ref explicitly so rolling channel tags (`beta`/`stable`) cannot collide with branch names.
    const branch = ((await $`git branch --show-current`.cwd(RELEASE_ROOT).text()).trim()
      || (await $`git rev-parse --abbrev-ref HEAD`.cwd(RELEASE_ROOT).text()).trim()).replace(/^heads\//, "")
    await $`git push origin HEAD:refs/heads/${branch}`.cwd(RELEASE_ROOT)
    ctx.reporter.detail(`version commit pushed to ${branch}`)
  }

  const sha = (await $`git rev-parse HEAD`.cwd(RELEASE_ROOT).text()).trim()
  ctx.state = { ...ctx.state, sha, updatedAt: new Date().toISOString() }
  writeState(ctx.version, ctx.state)
  ctx.reporter.detail(`release state sha ${sha.slice(0, 8)}`)

  return ctx.version
}

export async function runBuild(ctx: StageContext): Promise<void> {
  const { paths, version } = ctx
  if (ctx.dryRun) {
    ctx.reporter.detail(`would build product binaries + installers into dist/v${version}/ and dist/${paths.channel}/`)
    return
  }

  const head = (await $`git rev-parse HEAD`.cwd(RELEASE_ROOT).text()).trim()
  if (ctx.state.sha && ctx.state.sha !== head) {
    throw new Error(
      `refusing to build: release state sha ${ctx.state.sha.slice(0, 8)} ≠ HEAD ${head.slice(0, 8)}`,
    )
  }

  mkdirSync(paths.dist, { recursive: true })
  mkdirSync(paths.channelDist, { recursive: true })

  // Shared entry: packs template + buildSpinosaBinaries → flat product assets + build-manifest.json
  const build = await $`bun script/build-release-binaries.ts --out-dir ${paths.dist} --version ${version} --channel ${paths.channel}`
    .cwd(RELEASE_ROOT)
    .nothrow()
  if (build.exitCode !== 0) {
    throw new Error("product binary build failed — see script/build-release-binaries.ts")
  }

  for (const binaryPath of Object.values(paths.binaryPaths)) {
    if (!existsSync(binaryPath)) throw new Error(`missing binary after build: ${binaryPath}`)
    chmodSync(binaryPath, 0o755)
  }

  const builtManifest = JSON.parse(readFileSync(paths.manifestPath, "utf-8")) as BuildManifest
  if (!builtManifest.templatePackId) {
    throw new Error("build-manifest.json missing templatePackId after binary build")
  }
  ctx.reporter.detail(`templatePackId ${builtManifest.templatePackId.slice(0, 12)}…`)

  const installSource = readFileSync(resolve(RELEASE_ROOT, "install.sh"), "utf-8")
  const patchInstaller = (source: string, pinnedVersion: string, pinnedTag: string) =>
    source
      .replace(/^PINNED_VERSION=".*"/m, `PINNED_VERSION="${pinnedVersion}"`)
      .replace(/^PINNED_TAG=".*"/m, `PINNED_TAG="${pinnedTag}"`)

  writeFileSync(paths.installPath, patchInstaller(installSource, version, paths.tag))
  writeFileSync(paths.channelInstallPath, patchInstaller(installSource, version, paths.channel))

  // Re-write manifest after installers so version/channel stay authoritative for this cut.
  const manifest: BuildManifest = {
    product: "spinosa",
    version,
    channel: paths.channel,
    templatePackId: builtManifest.templatePackId,
    assets: buildManifestAssets(),
  }
  writeFileSync(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  // Immutable assets hashed into checksums.txt (checksums.txt itself is published, not self-hashed).
  const immutableHashed = [
    "install.sh",
    ...paths.binaryNames,
    "build-manifest.json",
  ]
  const checksums = await $`shasum -a 256 ${immutableHashed}`.cwd(paths.dist).text()
  writeFileSync(paths.checksumsPath, formatChecksums(checksums))

  const channelChecksums = await $`shasum -a 256 install.sh`.cwd(paths.channelDist).text()
  writeFileSync(paths.channelChecksumsPath, formatChecksums(channelChecksums))

  ctx.reporter.detail(paths.dist)
  ctx.reporter.detail(paths.channelDist)
  ctx.reporter.detail(`binaries ${paths.binaryNames.join(", ")}`)
}

function formatChecksums(text: string): string {
  return text.split("\n").filter(Boolean).map((line) => {
    const [hash, file] = line.split(/\s+/, 2)
    return `${hash}  ${file}`
  }).join("\n") + "\n"
}

export async function runVerifyLocal(ctx: StageContext): Promise<void> {
  const { paths, version } = ctx
  if (ctx.dryRun) {
    ctx.reporter.detail("would verify local installers, binaries, manifest, and checksums")
    return
  }

  const expected = expectedImmutableReleaseAssets(version)
  for (const name of expected) {
    const file = resolve(paths.dist, name)
    if (!existsSync(file)) throw new Error(`missing local asset ${file}`)
  }
  for (const name of expectedChannelReleaseAssets()) {
    const file = resolve(paths.channelDist, name)
    if (!existsSync(file)) throw new Error(`missing channel asset ${file}`)
  }

  // Hard cut: no product archive under dist.
  const strayArchive = resolve(paths.dist, `spinosa-v${version}.tar.gz`)
  if (existsSync(strayArchive)) {
    throw new Error(`refusing archive product asset ${strayArchive} — binary distribution only`)
  }

  for (const binaryPath of Object.values(paths.binaryPaths)) {
    const st = statSync(binaryPath)
    if (st.size <= 0) throw new Error(`binary looks empty: ${binaryPath}`)
    if ((st.mode & 0o111) === 0) throw new Error(`binary not executable: ${binaryPath}`)
  }

  const pinned = parseInstallPinnedVersion(readFileSync(paths.installPath, "utf-8"))
  if (pinned !== version) throw new Error(`dist installer PINNED_VERSION=${pinned}, expected ${version}`)

  const channelPinned = parseInstallPinnedVersion(readFileSync(paths.channelInstallPath, "utf-8"))
  if (channelPinned !== version) {
    throw new Error(`channel installer PINNED_VERSION=${channelPinned}, expected ${version}`)
  }

  const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf-8")) as BuildManifest
  if (manifest.product !== "spinosa") throw new Error(`manifest product=${manifest.product}, expected spinosa`)
  if (manifest.version !== version) throw new Error(`manifest version=${manifest.version}, expected ${version}`)
  if (manifest.channel !== paths.channel) {
    throw new Error(`manifest channel=${manifest.channel}, expected ${paths.channel}`)
  }
  if (!manifest.templatePackId) throw new Error("manifest missing templatePackId")
  for (const target of Object.keys(buildManifestAssets()) as ProductBinaryTarget[]) {
    if (manifest.assets[target] !== productBinaryAssetName(target)) {
      throw new Error(`manifest assets[${target}]=${manifest.assets[target]}, expected ${productBinaryAssetName(target)}`)
    }
  }

  const checksums = parseChecksums(readFileSync(paths.checksumsPath, "utf-8"))
  assertChecksum(paths.installPath, checksums.get("install.sh"), "install.sh")
  assertChecksum(paths.manifestPath, checksums.get("build-manifest.json"), "build-manifest.json")
  for (const name of paths.binaryNames) {
    assertChecksum(resolve(paths.dist, name), checksums.get(name), name)
  }
  for (const name of ["install.sh", ...paths.binaryNames, "build-manifest.json"]) {
    if (!checksums.has(name)) throw new Error(`checksums.txt missing entry for ${name}`)
  }

  const channelChecksums = parseChecksums(readFileSync(paths.channelChecksumsPath, "utf-8"))
  assertChecksum(paths.channelInstallPath, channelChecksums.get("install.sh"), `${paths.channel}/install.sh`)
}

export async function runSmoke(ctx: StageContext): Promise<void> {
  const { paths } = ctx
  // Structure-only is a local escape hatch only — never the release default.
  const structureOnly = process.env.SPINOSA_SMOKE_STRUCTURE === "1"
  if (ctx.dryRun) {
    ctx.reporter.detail(
      structureOnly
        ? "would structure-smoke local binary release assets (SPINOSA_SMOKE_STRUCTURE=1)"
        : "would full-smoke binary installer via local HTTP (SPINOSA_RELEASE_BASE_URL)",
    )
    return
  }
  if (!existsSync(paths.installPath) || !existsSync(paths.checksumsPath)) {
    throw new Error(`smoke requires release assets at ${paths.dist}`)
  }
  const flags = ["--dist", paths.dist]
  if (structureOnly) flags.push("--structure")
  const result = await $`bun script/smoke-install.ts ${flags}`.cwd(RELEASE_ROOT).nothrow()
  if (result.exitCode !== 0) {
    throw new Error(
      "local binary installer smoke failed — published installs would break for users; see script/smoke-install.ts",
    )
  }
  ctx.reporter.detail(structureOnly ? `structure-smoked ${paths.dist}` : `full-smoked ${paths.dist}`)
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^([a-f0-9]{64})\s+(.+)$/i)
    if (!match) continue
    map.set(match[2]!.replace(/^\*\.?/, "").trim(), match[1]!.toLowerCase())
  }
  return map
}

function assertChecksum(filePath: string, expectedHash: string | undefined, label: string): void {
  if (!expectedHash) throw new Error(`checksums.txt missing entry for ${label}`)
  const actual = sha256(filePath)
  if (actual !== expectedHash) {
    throw new Error(`checksum mismatch for ${label}`)
  }
}

export async function runGitTag(ctx: StageContext): Promise<void> {
  const { paths } = ctx
  if (ctx.dryRun) {
    ctx.reporter.detail(`would tag and push ${paths.tag}`)
    return
  }

  const head = (await $`git rev-parse HEAD`.cwd(RELEASE_ROOT).text()).trim()
  if (ctx.state.sha && ctx.state.sha !== head) {
    throw new Error(
      `refusing to tag: release state sha ${ctx.state.sha.slice(0, 8)} ≠ HEAD ${head.slice(0, 8)}`,
    )
  }

  const tagExists = await $`git rev-parse ${paths.tag}`.cwd(RELEASE_ROOT).nothrow().quiet()
  if (tagExists.exitCode === 0) {
    const tagSha = (await $`git rev-list -1 ${paths.tag}`.cwd(RELEASE_ROOT).text()).trim()
    if (tagSha !== head) {
      throw new Error(
        `refusing to reuse ${paths.tag}: points at ${tagSha.slice(0, 8)}, HEAD is ${head.slice(0, 8)}`,
      )
    }
    ctx.reporter.detail(`tag ${paths.tag} already at HEAD`)
  } else {
    await $`git tag ${paths.tag} ${head}`.cwd(RELEASE_ROOT)
  }
  await $`git push origin refs/tags/${paths.tag}`.cwd(RELEASE_ROOT)
  ctx.reporter.detail(`tag ${paths.tag} pushed`)
}

export async function runPublishVersion(ctx: StageContext): Promise<void> {
  const { paths, version } = ctx
  if (ctx.dryRun) {
    ctx.reporter.detail(`would create GitHub release ${paths.tag} with binary assets`)
    return
  }

  await resolveGhToken()
  const assets = expectedImmutableReleaseAssets(version).map((name) => `dist/v${version}/${name}`)
  const prerelease = version.includes("-")
  const createArgs = [
    "release", "create", paths.tag,
    "--title", `Spinosa v${version}`,
    "--generate-notes",
    ...(prerelease ? ["--prerelease"] : []),
    ...assets,
  ]

  const existing = await $`gh release view ${paths.tag}`.cwd(RELEASE_ROOT).nothrow().quiet()
  if (existing.exitCode === 0) {
    const remoteCheck = resolve(paths.dist, ".remote-check")
    mkdirSync(remoteCheck, { recursive: true })
    const downloaded = await $`gh release download ${paths.tag} --pattern checksums.txt --pattern build-manifest.json --dir ${remoteCheck} --clobber`
      .cwd(RELEASE_ROOT)
      .nothrow()
      .quiet()
    const remoteChecksums = resolve(remoteCheck, "checksums.txt")
    const remoteManifest = resolve(remoteCheck, "build-manifest.json")
    if (downloaded.exitCode === 0 && existsSync(remoteChecksums) && existsSync(remoteManifest)) {
      const localChecksums = sha256(paths.checksumsPath)
      const remoteChecksumsHash = sha256(remoteChecksums)
      const localManifest = sha256(paths.manifestPath)
      const remoteManifestHash = sha256(remoteManifest)
      if (localChecksums !== remoteChecksumsHash || localManifest !== remoteManifestHash) {
        throw new Error(
          `refusing to clobber immutable release ${paths.tag}: checksums/manifest differ ` +
            `(checksums local ${localChecksums.slice(0, 12)} ≠ remote ${remoteChecksumsHash.slice(0, 12)}; ` +
            `manifest local ${localManifest.slice(0, 12)} ≠ remote ${remoteManifestHash.slice(0, 12)})`,
        )
      }
      ctx.reporter.detail(`existing ${paths.tag} checksums+manifest match — skip upload`)
      return
    }
    throw new Error(
      `GitHub release ${paths.tag} already exists but checksums.txt/build-manifest.json could not be verified — refuse immutable republish`,
    )
  }

  await $`gh ${createArgs}`.cwd(RELEASE_ROOT)
  ctx.reporter.detail(`created GitHub release ${paths.tag}`)
}

export async function runChannel(ctx: StageContext): Promise<void> {
  const { paths, version } = ctx
  if (!existsSync(paths.channelInstallPath)) {
    throw new Error(`channel assets missing at ${paths.channelDist} — run build first`)
  }
  if (ctx.dryRun) {
    ctx.reporter.detail(`would sync rolling ${paths.channel} channel to v${version}`)
    return
  }

  await resolveGhToken()
  const sha = (await $`git rev-parse HEAD`.cwd(RELEASE_ROOT)).text().trim()
  await $`git tag -f ${paths.channel} ${sha}`.cwd(RELEASE_ROOT)
  await $`git push origin refs/tags/${paths.channel}:refs/tags/${paths.channel} --force`.cwd(RELEASE_ROOT)
  await publishRollingChannelRelease({
    version,
    channel: paths.channel,
    channelDist: paths.channelDist,
  })
  ctx.reporter.detail(`rolling ${paths.channel} → ${sha.slice(0, 8)}`)
}

export async function runVerifyRemote(ctx: StageContext): Promise<void> {
  const { paths, version } = ctx
  if (ctx.dryRun) {
    ctx.reporter.detail("would verify live rolling and versioned installers")
    return
  }

  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
    const pinned = await assertRollingChannelInstaller({ version, channel: paths.channel })
    ctx.reporter.detail(`rolling ${paths.channel} PINNED_VERSION=${pinned}`)
  } else {
    const pinned = await assertLiveInstaller(
      `https://github.com/medialab/spinosa/releases/download/${paths.channel}/install.sh`,
      paths.channel,
      version,
    )
    ctx.reporter.detail(`rolling ${paths.channel} PINNED_VERSION=${pinned}`)
  }

  const versionPinned = await assertLiveInstaller(
    `https://github.com/medialab/spinosa/releases/download/${paths.tag}/install.sh`,
    paths.tag,
    version,
  )
  ctx.reporter.detail(`versioned ${paths.tag} PINNED_VERSION=${versionPinned}`)

  // Optional remote binary smoke — downloads the host platform product binary.
  // SPINOSA_SMOKE_STRUCTURE=1 for asset presence only.
  if (process.env.SPINOSA_SMOKE_REMOTE === "1") {
    const remoteDir = resolve(paths.dist, ".remote-smoke")
    mkdirSync(remoteDir, { recursive: true })
    const hostTarget = resolveProductBinaryTarget({
      os: process.platform,
      arch: process.arch,
    })
    const hostBinary = productBinaryAssetName(hostTarget)
    await $`gh release download ${paths.tag} --pattern ${hostBinary} --dir ${remoteDir} --clobber`
      .cwd(RELEASE_ROOT)
    const remoteBinary = resolve(remoteDir, hostBinary)
    const flags = ["--binary", remoteBinary]
    if (process.env.SPINOSA_SMOKE_STRUCTURE === "1") flags.push("--structure")
    const smoke = await $`bun script/smoke-install.ts ${flags}`.cwd(RELEASE_ROOT).nothrow()
    if (smoke.exitCode !== 0) throw new Error("remote binary smoke failed")
    ctx.reporter.detail(`remote smoke passed for ${paths.tag} (${hostBinary})`)
  }
}

async function assertLiveInstaller(url: string, label: string, version: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`failed to download live ${label} installer (${response.status})`)
  const script = await response.text()
  const pinned = script.match(/^PINNED_VERSION="([^"]+)"/m)?.[1]
  if (!pinned) throw new Error(`could not read PINNED_VERSION from live ${label} installer`)
  if (pinned !== version) {
    throw new Error(`live ${label} installer serves PINNED_VERSION=${pinned}, expected ${version}`)
  }
  return pinned
}

const STAGE_RUNNERS: Record<StageName, (ctx: StageContext) => Promise<void | string>> = {
  preflight: runPreflight,
  bump: runBump,
  build: runBuild,
  verifyLocal: runVerifyLocal,
  smoke: runSmoke,
  gitTag: runGitTag,
  publishVersion: runPublishVersion,
  channel: runChannel,
  verifyRemote: runVerifyRemote,
}

export async function runStage(stage: StageName, ctx: StageContext): Promise<StageContext> {
  const started = performance.now()
  ctx.reporter.start(stage)
  try {
    const result = await STAGE_RUNNERS[stage](ctx)
    let next = ctx
    if (stage === "bump" && typeof result === "string") {
      next = {
        ...ctx,
        version: result,
        paths: releasePaths(result),
      }
    }
    const durationMs = Math.round(performance.now() - started)
    if (!ctx.dryRun) next.state = markStage(next.state, stage, { status: "ok", durationMs })
    else next.state = { ...next.state, stages: { ...next.state.stages, [stage]: { status: "ok", at: new Date().toISOString(), durationMs } } }
    ctx.reporter.complete()
    return next
  } catch (error) {
    const durationMs = Math.round(performance.now() - started)
    const message = error instanceof Error ? error.message : String(error)
    if (!ctx.dryRun) markStage(ctx.state, stage, { status: "failed", durationMs, error: message })
    throw error
  }
}

export { readCurrentVersion } from "./bump.ts"
