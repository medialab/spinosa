#!/usr/bin/env bun
/**
 * Build Spinosa-owned OCR tool tarballs from pinned source (local only).
 *
 * Produces per-platform `spinosa-tools-<os>-<arch>.tar.gz` release assets:
 *   <target>/bin/tesseract                 (static binary, see below)
 *   <target>/tessdata/{eng,ita,fra}.traineddata  (pinned commit, SHA verified)
 *
 * There is no CI for this: the release machine builds every tarball locally.
 *   darwin-* → compiled on this Mac (x64 via -arch cross-compile)
 *   linux-*  → compiled inside local Lima Ubuntu guests (native arch),
 *              or natively when the host already is matching-arch Linux
 *              (GitHub Actions ubuntu runners) — no Lima needed there.
 *
 * Containment: tesseract links only base-system libs on macOS (SDK zlib,
 * static image libs) and is fully static on Linux. The produced binary never
 * needs anything the user installs — no brew/apt/dnf/pacman, no dylibs, no
 * LD_LIBRARY_PATH. The build module (scripts/release/tools-target.ts) gates
 * linkage fail-closed at build time; this orchestrator re-verifies every
 * tarball (version, langs, blank-PNG OCR probe where runnable).
 *
 * Usage:
 *   bun scripts/build-tools-tarballs.ts --out-dir dist/vX.Y.Z [--only darwin-arm64,...]
 *   bun scripts/build-tools-tarballs.ts --out-dir dist/vX.Y.Z --host-only
 *   bun scripts/build-tools-tarballs.ts --help
 *
 * Lima guests (create once per release machine):
 *   limactl start --name spinosa-tools-linux-arm64 template://ubuntu
 *   limactl start --name spinosa-tools-linux-x64 --arch x86_64 template://ubuntu
 */
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { deflateSync } from "node:zlib"
import semver from "semver"
import {
  PRODUCT_BINARY_TARGETS,
  productToolsAssetName,
  type ProductBinaryTarget,
} from "../packages/spinosa-core/src/distribution/contract.ts"
import { info, ok, startTimer, step, warn } from "./release/log.ts"
import {
  SOURCE_PINS,
  TESSERACT_VERSION,
  buildToolTarget,
  ccachePrefix,
  limaRunner,
  localRunner,
} from "./release/tools-target.ts"

export type ToolsTarget = ProductBinaryTarget
export const TOOLS_TARGETS: readonly ToolsTarget[] = PRODUCT_BINARY_TARGETS

/** Canonical release asset name (single source of truth lives in contract.ts). */
export function toolsTarballName(target: ToolsTarget): string {
  return productToolsAssetName(target)
}

/** Normalize a reuse tag to v<semver> (or undefined when unparseable). */
export function normalizeReuseTag(tag: string): string | undefined {
  const clean = tag.trim().replace(/^v/, "")
  return semver.valid(clean) ? `v${clean}` : undefined
}

/** Greatest beta tag strictly below currentVersion (both v-prefixed tags).
 * Pure helper so unit tests cover reuse selection without git. */
export function previousReleaseTag(currentVersion: string, tags: string[]): string | undefined {
  const current = currentVersion.replace(/^v/, "")
  if (!semver.valid(current)) return undefined
  const candidates = tags
    .map((t) => t.trim().replace(/^v/, ""))
    .filter((v) => semver.valid(v) && semver.prerelease(v)?.[0] === "beta" && semver.lt(v, current))
    .sort(semver.compare)
  const prev = candidates.at(-1)
  return prev ? `v${prev}` : undefined
}

function gitBetaTags(): string[] {
  try {
    const out = Bun.spawnSync(["git", "tag", "--list", "v*"])
    if (out.exitCode !== 0) return []
    return out.stdout.toString().split("\n").map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Pin-aware reuse: fetch the same tarball from a previous GitHub release
 * and adopt it only if it verifies against CURRENT pins (tesseract version,
 * tessdata SHAs, layout, OCR probe). Tool tarballs depend solely on pins,
 * never on the product version — so a verified older asset is identical to
 * a fresh build. Returns true when reused; any miss or mismatch falls
 * through to a from-source build with a clear log line.
 */
async function tryReuseFromRelease(opts: {
  tarball: string
  target: ToolsTarget
  outDir: string
  reuseTag: string
  workDir: string
  tessPins: TessdataPins
}): Promise<boolean> {
  const { tarball, target, outDir, reuseTag, workDir, tessPins } = opts
  const name = path.basename(tarball)
  if (!Bun.which("gh")) {
    warn("tools", `${target}: gh CLI not found — cannot check ${reuseTag}, building from source`)
    return false
  }
  const tmp = path.join(workDir, "reuse", target)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  try {
    await capture(["gh", "release", "download", reuseTag, "--pattern", name, "--dir", tmp, "--clobber"])
  } catch {
    info("tools", `${target}: no ${name} on ${reuseTag} — building from source`)
    return false
  }
  const downloaded = path.join(tmp, name)
  try {
    await verifyTarball(downloaded, target, tessPins)
  } catch (error) {
    warn("tools", `${target}: ${reuseTag} asset fails current pins (${error instanceof Error ? error.message.split("\n")[0] : error}) — rebuilding from source`)
    return false
  }
  rmSync(tarball, { force: true })
  await run(["cp", downloaded, tarball])
  ok("tools", `${target}: reused ${name} from ${reuseTag} (pins verified, no rebuild)`)
  return true
}

export type TessdataPins = {
  commit: string
  base: string
  sha: Record<"eng" | "ita" | "fra", string>
}

/** Tessdata pins live in install.sh (single source of truth, shared with inventory.ts). */
export function parseTessdataPins(installSh: string): TessdataPins {
  const commit = installSh.match(/^TESSDATA_PIN_COMMIT="([^"]+)"/m)?.[1]
  if (!commit) throw new Error("install.sh: TESSDATA_PIN_COMMIT not found")
  const sha = {} as Record<"eng" | "ita" | "fra", string>
  for (const lang of ["eng", "ita", "fra"] as const) {
    const hit = installSh.match(new RegExp(`^TESSDATA_SHA_${lang}="([^"]+)"`, "m"))?.[1]
    if (!hit || !/^[0-9a-f]{64}$/i.test(hit)) {
      throw new Error(`install.sh: TESSDATA_SHA_${lang} missing or not a SHA256`)
    }
    sha[lang] = hit
  }
  return {
    commit,
    base: `https://github.com/tesseract-ocr/tessdata_fast/raw/${commit}`,
    sha,
  }
}

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex")
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i < 0 ? undefined : process.argv[i + 1]
}

/** Minimal white PNG (no image deps): used for the end-to-end OCR probe. */
export function blankPng(width = 200, height = 60): Buffer {
  const crcTable = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c
  }
  const crc = (buf: Buffer): number => {
    let c = ~0
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, "ascii"), data])
    const cs = Buffer.alloc(4)
    cs.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, cs])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor
  const row = Buffer.alloc(1 + width * 3, 255)
  row[0] = 0 // PNG filter byte: 0 = None (must be 0-4, never 255)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

async function run(cmd: string[], opts?: { cwd?: string }): Promise<void> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exit = await proc.exited
  if (exit !== 0) throw new Error(`command failed (exit ${exit}): ${cmd.join(" ")}`)
}

async function capture(cmd: string[], opts?: { env?: Record<string, string | undefined> }): Promise<string> {
  const proc = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...opts?.env },
  })
  const [out, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ])
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text().catch(() => "")
    throw new Error(`command failed (exit ${exit}): ${cmd.join(" ")}\n${err.slice(0, 500)}`)
  }
  return out
}

async function ensureSources(sourcesDir: string): Promise<void> {
  mkdirSync(sourcesDir, { recursive: true })
  for (const pin of SOURCE_PINS) {
    const dest = path.join(sourcesDir, pin.file)
    if (existsSync(dest) && sha256File(dest) === pin.sha256) {
      info("tools", `= ${pin.file} (cached, SHA ok)`)
      continue
    }
    info("tools", `↓ downloading ${pin.url}`)
    await run(["curl", "-fSL", "--retry", "3", "--max-time", "600", pin.url, "-o", dest])
    const got = sha256File(dest)
    if (got !== pin.sha256) {
      rmSync(dest, { force: true })
      throw new Error(`SHA256 mismatch for ${pin.file}: want ${pin.sha256}, got ${got} — refusing to build from unverified source`)
    }
    ok("tools", `${pin.file} (SHA ok)`)
  }
}

function cpuCount(): number {
  const n = navigator.hardwareConcurrency ?? 4
  return Math.max(1, Math.floor(n))
}

async function buildDarwin(target: ToolsTarget, sourcesDir: string, prefix: string, workDir: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(`${target} must be built on a Mac (this host is ${process.platform})`)
  }
  const sdk = (await capture(["xcrun", "--show-sdk-path"])).trim()
  if (!sdk) throw new Error("xcrun SDK not found (install Xcode command line tools on the build Mac)")
  const buildRoot = path.join(workDir, `build-${target}`)
  rmSync(prefix, { recursive: true, force: true })
  rmSync(buildRoot, { recursive: true, force: true })
  mkdirSync(buildRoot, { recursive: true })
  step("tools", `${target}: compiling on this Mac (static tesseract — minutes, per-library lines below)`)
  const compileElapsed = startTimer()
  const useCcache = ccachePrefix() !== ""
  info("tools", `${target}: ccache ${useCcache ? "on (warm cache hits skip recompiles)" : "off (install ccache for incremental rebuilds)"}`)
  await buildToolTarget({
    target,
    os: "darwin",
    arch: target === "darwin-arm64" ? "arm64" : "x86_64",
    sourcesDir,
    prefix,
    buildRoot,
    jobs: cpuCount(),
    runner: localRunner(),
    sdkPath: sdk,
    ccache: useCcache,
  })
  ok("tools", `${target}: host compile finished`, compileElapsed())
}

function limaInstances(): string[] {
  try {
    const out = Bun.spawnSync(["limactl", "list", "-q"])
    if (out.exitCode !== 0) return []
    return out.stdout.toString().split("\n").map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export type HostSpec = { platform: string; arch: string }

/** True when the host can compile a linux target natively (no Lima):
 * matching-arch Linux (e.g. GitHub Actions ubuntu runners). Pure helper
 * (host injectable) so unit tests cover the selection matrix. */
export function canBuildLinuxNative(
  target: ToolsTarget,
  host: HostSpec = { platform: process.platform, arch: process.arch },
): boolean {
  if (!target.startsWith("linux-") || host.platform !== "linux") return false
  const wantArch = target.endsWith("x64") ? "x64" : "arm64"
  const hostArch = host.arch === "arm64" || host.arch === "aarch64"
    ? "arm64"
    : ["x64", "x86_64", "amd64"].includes(host.arch)
      ? "x64"
      : undefined
  return hostArch === wantArch
}

/** Compile a linux target directly on a matching-arch Linux host
 * (CI ubuntu runners). Same pins, flags, gates and probes as the Lima
 * path — only the transport differs. Toolchain installs via apt only
 * for tools missing from the host (runners already ship gcc/cmake). */
async function buildLinuxNative(
  target: ToolsTarget,
  sourcesDir: string,
  prefix: string,
  workDir: string,
): Promise<string> {
  const wantArch = target.endsWith("x64") ? "x64" : "arm64"
  if (!canBuildLinuxNative(target)) {
    throw new Error(`${target} needs native ${wantArch} Linux (this host is ${process.platform}-${process.arch}) — use a matching runner or Lima`)
  }
  const missing = ["gcc", "g++", "cmake", "make", "file"].filter((tool) => !Bun.which(tool))
  if (missing.length > 0) {
    step("tools", `${target}: installing missing host toolchain (${missing.join(", ")}) via apt`)
    await run(["sudo", "apt-get", "update", "-qq"])
    await run(["sudo", "apt-get", "install", "-y", "-qq", "build-essential", "cmake", "file"])
    ok("tools", `${target}: host toolchain ready`)
  } else {
    info("tools", `${target}: host toolchain present (gcc/g++/cmake/make/file) — no apt needed`)
  }
  const buildRoot = path.join(workDir, `build-${target}`)
  rmSync(prefix, { recursive: true, force: true })
  rmSync(buildRoot, { recursive: true, force: true })
  mkdirSync(buildRoot, { recursive: true })
  const jobs = cpuCount()
  info("tools", `${target}: compiling natively with ${jobs} jobs (static tesseract — minutes, per-library lines below)`)
  const compileElapsed = startTimer()
  const useCcache = ccachePrefix() !== ""
  info("tools", `${target}: ccache ${useCcache ? "on (warm cache hits skip recompiles)" : "off (install ccache for incremental rebuilds)"}`)
  await buildToolTarget({
    target,
    os: "linux",
    arch: wantArch,
    sourcesDir,
    prefix,
    buildRoot,
    jobs,
    runner: localRunner(),
    ccache: useCcache,
  })
  ok("tools", `${target}: native compile finished`, compileElapsed())
  return path.join(prefix, "bin", "tesseract")
}

async function buildLinuxViaLima(
  target: ToolsTarget,
  sourcesDir: string,
  prefix: string,
  workDir: string,
): Promise<string> {
  void workDir
  const instance = `spinosa-tools-${target}`
  const known = limaInstances()
  if (!known.includes(instance)) {
    const archFlag = target.endsWith("x64") ? " --arch x86_64" : ""
    throw new Error(
      `Lima instance missing: ${instance}\ncreate it once on this release machine:\n  limactl start --name ${instance}${archFlag} template://ubuntu`,
    )
  }
  const guestRoot = `/tmp/spinosa-tools/${target}`
  const guestSources = `${guestRoot}/sources`
  const guestPrefix = `${guestRoot}/prefix`
  const guestBuild = `${guestRoot}/build`
  // Toolchain inside OUR build VM (never on user machines): stock Ubuntu
  // template + build toolchain, sources copied in after host-side SHA verify.
  step("tools", `${target}: starting Lima guest ${instance} (first boot downloads/provisions — minutes, no output until ready)`)
  await run(["limactl", "start", instance])
  ok("tools", `${target}: guest ${instance} running`)
  step("tools", `${target}: waiting for guest first-boot provisioning (cloud-init — minutes on a fresh instance)`)
  // Non-fatal: cloud-init exits nonzero when boot had errors, but its
  // output still tells us whether provisioning settled. The apt-lock
  // wait below is the real gate.
  try {
    info("tools", `${target}: cloud-init says: ${(await capture(["limactl", "shell", instance, "--", "bash", "-c", "cloud-init status --wait"])).trim().split("\n").pop()}`)
  } catch (error) {
    warn("tools", `${target}: cloud-init wait failed (${error instanceof Error ? error.message.split("\n")[0] : error}) — continuing, apt-lock wait gates next`)
  }
  ok("tools", `${target}: guest provisioning settled`)
  step("tools", `${target}: waiting for any guest apt/dpkg lock to clear (up to 10 min)`)
  await run(["limactl", "shell", instance, "--", "bash", "-c",
    "for i in $(seq 1 60); do sudo fuser /var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break; sleep 10; done; sudo fuser /var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend >/dev/null 2>&1 && exit 1 || exit 0",
  ])
  ok("tools", `${target}: package locks free`)
  step("tools", `${target}: installing guest toolchain (apt-get — minutes, output streams below)`)
  await run(["limactl", "shell", instance, "--", "bash", "-c",
    "sudo apt-get update -qq && sudo apt-get install -y -qq build-essential cmake file",
  ])
  ok("tools", `${target}: guest toolchain ready`)
  step("tools", `${target}: preparing guest workspace ${guestRoot}`)
  await run(["limactl", "shell", instance, "--", "bash", "-c",
    `rm -rf ${guestRoot} && mkdir -p ${guestSources} ${guestPrefix} ${guestBuild}`,
  ])
  for (const pin of SOURCE_PINS) {
    info("tools", `${target}: copying source ${pin.file} → guest`)
    await run(["limactl", "copy", path.join(sourcesDir, pin.file), `${instance}:${guestSources}/`])
  }
  const jobs = Number.parseInt((await capture(["limactl", "shell", instance, "--", "nproc"])).trim(), 10) || 2
  info("tools", `${target}: compiling with ${jobs} jobs (static tesseract — tens of minutes, per-library lines below)`)
  const compileElapsed = startTimer()
  await buildToolTarget({
    target,
    os: "linux",
    arch: target.endsWith("x64") ? "x64" : "arm64",
    sourcesDir: guestSources,
    prefix: guestPrefix,
    buildRoot: guestBuild,
    jobs,
    runner: limaRunner(instance),
  })
  ok("tools", `${target}: guest compile finished`, compileElapsed())
  step("tools", `${target}: copying built tesseract back to host`)
  const localBin = path.join(prefix, "bin", "tesseract")
  rmSync(prefix, { recursive: true, force: true })
  mkdirSync(path.join(prefix, "bin"), { recursive: true })
  await run(["limactl", "copy", `${instance}:${guestPrefix}/bin/tesseract`, localBin])
  chmodSync(localBin, 0o755)
  return localBin
}

async function ensureTessdata(stageTess: string, pins: TessdataPins): Promise<void> {
  mkdirSync(stageTess, { recursive: true })
  for (const lang of ["eng", "ita", "fra"] as const) {
    const dest = path.join(stageTess, `${lang}.traineddata`)
    if (existsSync(dest) && sha256File(dest) === pins.sha[lang]) {
      info("tools", `= ${lang}.traineddata (cached, SHA ok)`)
      continue
    }
    await run(["curl", "-fSL", "--retry", "3", "--max-time", "300", `${pins.base}/${lang}.traineddata`, "-o", dest])
    const got = sha256File(dest)
    if (got !== pins.sha[lang]) {
      rmSync(dest, { force: true })
      throw new Error(`SHA256 mismatch for ${lang}.traineddata: want ${pins.sha[lang]}, got ${got}`)
    }
    ok("tools", `${lang}.traineddata (SHA ok)`)
  }
}

/** Verify a staged tarball; runs the binary when the host can execute it. */
async function verifyTarball(tarball: string, target: ToolsTarget, pins: TessdataPins): Promise<void> {
  const listed = (await capture(["tar", "-tzf", tarball])).split("\n").filter(Boolean)
  const files = listed.filter((e) => !e.endsWith("/")).sort()
  const want = [
    `${target}/bin/tesseract`,
    `${target}/tessdata/eng.traineddata`,
    `${target}/tessdata/fra.traineddata`,
    `${target}/tessdata/ita.traineddata`,
  ]
  const extra = files.filter((f) => !want.includes(f))
  const missing = want.filter((f) => !files.includes(f))
  if (extra.length > 0 || missing.length > 0) {
    throw new Error(`tarball layout wrong for ${target}: missing [${missing}] extra [${extra}]`)
  }
  const probe = path.join(tmpdir(), `spinosa-tools-verify-${target}-${Date.now()}`)
  rmSync(probe, { recursive: true, force: true })
  mkdirSync(probe, { recursive: true })
  try {
    await run(["tar", "-xzf", tarball, "-C", probe])
    const bin = path.join(probe, target, "bin", "tesseract")
    const tess = path.join(probe, target, "tessdata")
    chmodSync(bin, 0o755)
    for (const lang of ["eng", "ita", "fra"] as const) {
      const got = sha256File(path.join(tess, `${lang}.traineddata`))
      if (got !== pins.sha[lang]) throw new Error(`tarball tessdata ${lang} SHA mismatch`)
    }
    if (target.startsWith("linux-")) {
      const info = await capture(["file", bin]).catch(() => "")
      if (!info.includes("statically linked")) {
        throw new Error(`linux tarball binary not fully static: ${info.slice(0, 200)}`)
      }
      ok("tools", `${target}: layout + tessdata SHAs + fully static (execution verified at build time in guest)`)
      return
    }
    let versionOut: string
    try {
      versionOut = await capture([bin, "--version"])
    } catch {
      // Cross-arch darwin binary (x64 on arm64 without Rosetta): fall back to
      // arch + linkage evidence instead of execution.
      const archs = await capture(["lipo", "-archs", bin]).catch(() => "")
      const wantArch = target === "darwin-arm64" ? "arm64" : "x86_64"
      if (!archs.split(/\s+/).includes(wantArch)) throw new Error(`arch gate failed: lipo says ${archs}`)
      const linked = await capture(["otool", "-L", bin]).catch(() => "")
      if (/homebrew|\/opt\/|\/usr\/local\//i.test(linked)) throw new Error("linkage gate failed on cross-arch binary")
      ok("tools", `${target}: layout + tessdata SHAs + arch/linkage evidence (not executable on this host)`)
      return
    }
    if (!versionOut.includes(`tesseract ${TESSERACT_VERSION}`)) {
      throw new Error(`version gate failed: ${versionOut.split("\n")[0]}`)
    }
    const langs = await capture([bin, "--list-langs"], { env: { TESSDATA_PREFIX: tess } })
    for (const lang of ["eng", "ita", "fra"]) {
      if (!langs.split(/\s+/).includes(lang)) throw new Error(`--list-langs missing ${lang}: ${langs.slice(0, 200)}`)
    }
    // End-to-end probe: blank PNG through our libpng → LSTM init → empty out.
    const png = path.join(probe, "blank.png")
    writeFileSync(png, blankPng())
    const out = await capture([bin, png, "stdout", "-l", "eng", "--psm", "6"], { env: { TESSDATA_PREFIX: tess } })
    if (out.trim() !== "") throw new Error(`blank-PNG probe produced text: ${out.slice(0, 200)}`)
    ok("tools", `${target}: layout + version + langs + blank-PNG OCR probe`)
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage:
  bun scripts/build-tools-tarballs.ts --out-dir <dir> [--only <t,...>] [--host-only] [--work-dir <dir>] [--force]
    [--reuse-from <tag> | --reuse-previous] [--sources-dir <dir>]

Builds spinosa-tools-<os>-<arch>.tar.gz from pinned source (local only, no CI).
darwin targets compile on this Mac; linux targets compile in Lima guests
(spinosa-tools-linux-arm64 / spinosa-tools-linux-x64 — see header), or
natively on matching-arch Linux hosts (CI runners).

Reuse: --reuse-from vX.Y.Z downloads that release's tarballs and adopts
them after verifying against CURRENT pins (tesseract version, tessdata
SHAs, layout, OCR probe) — tool tarballs depend only on pins, never on
the product version. --reuse-previous picks the greatest beta tag below
the --out-dir version automatically. Anything missing or mismatched
builds from source; --force always rebuilds.`)
    process.exit(0)
  }
  const root = path.resolve(import.meta.dir, "..")
  const outDir = path.resolve(root, argValue("--out-dir") ?? path.join("dist", "tools-local"))
  const onlyRaw = argValue("--only")
  const hostOnly = process.argv.includes("--host-only")
  const force = process.argv.includes("--force")
  const workDir =
    argValue("--work-dir") ?? path.join(tmpdir(), "spinosa-tools-build")
  // Pinned sources live apart from per-run build trees so CI can persist
  // them across runs (actions/cache): present + SHA-verified archives are
  // never re-downloaded (see ensureSources).
  const sourcesDir = path.resolve(argValue("--sources-dir") ?? path.join(workDir, "sources"))
  const stageRoot = path.join(workDir, "stage")

  const hostTarget = `${process.platform}-${process.arch}` as ToolsTarget
  let wanted: ToolsTarget[] = [...TOOLS_TARGETS]
  if (onlyRaw) {
    const only = onlyRaw.split(",").map((s) => s.trim()).filter(Boolean)
    for (const t of only) {
      if (!(TOOLS_TARGETS as readonly string[]).includes(t)) {
        throw new Error(`--only unknown target: ${t} (want one of ${TOOLS_TARGETS.join(", ")})`)
      }
    }
    wanted = only as ToolsTarget[]
  } else if (hostOnly) {
    if (!(TOOLS_TARGETS as readonly string[]).includes(hostTarget)) {
      throw new Error(`host ${hostTarget} is not a tools target`)
    }
    wanted = [hostTarget]
  }

  // Pin-aware reuse: adopt verified tarballs from a previous release
  // instead of recompiling identical pins.
  const reuseFromRaw = argValue("--reuse-from")
  let reuseTag: string | undefined
  if (reuseFromRaw) {
    reuseTag = normalizeReuseTag(reuseFromRaw)
    if (!reuseTag) throw new Error(`--reuse-from unparseable tag: ${reuseFromRaw} (want vX.Y.Z)`)
  } else if (process.argv.includes("--reuse-previous")) {
    const outBase = path.basename(outDir)
    const outVersion = outBase.replace(/^v/, "")
    reuseTag = previousReleaseTag(outVersion, gitBetaTags()) ?? undefined
    if (reuseTag) {
      info("tools", `reuse: previous release ${reuseTag} (below ${outBase})`)
    } else {
      info("tools", `reuse: no previous beta tag below ${outBase} — building all from source`)
    }
  }

  const installSh = readFileSync(path.join(root, "install.sh"), "utf-8")
  const tessPins = parseTessdataPins(installSh)
  info("tools", `tessdata commit ${tessPins.commit}`)
  mkdirSync(outDir, { recursive: true })

  step("tools", "sources (pinned, SHA256-verified)")
  await ensureSources(sourcesDir)

  const totalElapsed = startTimer()
  let index = 0
  for (const target of wanted) {
    index += 1
    const tag = `[${index}/${wanted.length}]`
    const tarball = path.join(outDir, toolsTarballName(target))
    if (existsSync(tarball) && !force) {
      info("tools", `${tag} ${target}: ${path.basename(tarball)} exists (use --force to rebuild)`)
      await verifyTarball(tarball, target, tessPins)
      continue
    }
    if (!force && reuseTag) {
      const reused = await tryReuseFromRelease({ tarball, target, outDir, reuseTag, workDir, tessPins })
      if (reused) continue
    }
    const targetElapsed = startTimer()
    step("tools", `${tag} ${target}: building tesseract ${TESSERACT_VERSION} from source`)
    const prefix = path.join(workDir, `prefix-${target}`)
    if (target.startsWith("darwin-")) {
      await buildDarwin(target, sourcesDir, prefix, workDir)
    } else {
      if (process.platform !== "darwin" && process.platform !== "linux") {
        throw new Error(`${target} needs limactl on macOS/Linux (this host is ${process.platform})`)
      }
      if (canBuildLinuxNative(target)) {
        info("tools", `${tag} ${target}: matching-arch Linux host — building natively (no Lima)`)
        await buildLinuxNative(target, sourcesDir, prefix, workDir)
      } else {
        await buildLinuxViaLima(target, sourcesDir, prefix, workDir)
      }
    }
    const stage = path.join(stageRoot, target)
    rmSync(stage, { recursive: true, force: true })
    mkdirSync(path.join(stage, "bin"), { recursive: true })
    const builtBin = path.join(prefix, "bin", "tesseract")
    if (!existsSync(builtBin)) throw new Error(`worker did not produce ${builtBin}`)
    await run(["cp", builtBin, path.join(stage, "bin", "tesseract")])
    chmodSync(path.join(stage, "bin", "tesseract"), 0o755)
    step("tools", `${tag} ${target}: staging tessdata (pinned ${tessPins.commit.slice(0, 12)}…)`)
    await ensureTessdata(path.join(stage, "tessdata"), tessPins)
    rmSync(tarball, { force: true })
    step("tools", `${tag} ${target}: packing ${path.basename(tarball)}`)
    await run(["tar", "-czf", tarball, "-C", stageRoot, target])
    const st = statSync(tarball)
    if (st.size < 1024 * 100) throw new Error(`tarball suspiciously small: ${tarball} (${st.size} bytes)`)
    step("tools", `${tag} ${target}: verifying ${path.basename(tarball)}`)
    await verifyTarball(tarball, target, tessPins)
    ok("tools", `${tag} ${target}: ${tarball} (${st.size} bytes, sha256 ${sha256File(tarball).slice(0, 16)}…)`, targetElapsed())
  }

  const names = wanted.map(toolsTarballName)
  const stray = readdirSync(outDir).filter((f) => f.startsWith("spinosa-tools-") && !names.includes(f))
  if (stray.length > 0) info("tools", `unrelated files in out-dir left alone: ${stray.join(", ")}`)
  ok("tools", `tarballs → ${outDir}`, totalElapsed())
}
