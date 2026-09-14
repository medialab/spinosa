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
 *   linux-*  → compiled inside local Lima Ubuntu guests (native arch)
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
import {
  PRODUCT_BINARY_TARGETS,
  productToolsAssetName,
  type ProductBinaryTarget,
} from "../packages/spinosa-core/src/distribution/contract.ts"
import {
  SOURCE_PINS,
  TESSERACT_VERSION,
  buildToolTarget,
  limaRunner,
  localRunner,
} from "./release/tools-target.ts"

export type ToolsTarget = ProductBinaryTarget
export const TOOLS_TARGETS: readonly ToolsTarget[] = PRODUCT_BINARY_TARGETS

/** Canonical release asset name (single source of truth lives in contract.ts). */
export function toolsTarballName(target: ToolsTarget): string {
  return productToolsAssetName(target)
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
      console.log(`  = ${pin.file} (cached, SHA ok)`)
      continue
    }
    console.log(`  ↓ ${pin.url}`)
    await run(["curl", "-fSL", "--retry", "3", "--max-time", "600", pin.url, "-o", dest])
    const got = sha256File(dest)
    if (got !== pin.sha256) {
      rmSync(dest, { force: true })
      throw new Error(`SHA256 mismatch for ${pin.file}: want ${pin.sha256}, got ${got} — refusing to build from unverified source`)
    }
    console.log(`  ✓ ${pin.file} (SHA ok)`)
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
  })
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
  await run(["limactl", "start", instance])
  await run(["limactl", "shell", instance, "--", "bash", "-c",
    "sudo apt-get update -qq && sudo apt-get install -y -qq build-essential cmake file",
  ])
  await run(["limactl", "shell", instance, "--", "bash", "-c",
    `rm -rf ${guestRoot} && mkdir -p ${guestSources} ${guestPrefix} ${guestBuild}`,
  ])
  for (const pin of SOURCE_PINS) {
    await run(["limactl", "copy", path.join(sourcesDir, pin.file), `${instance}:${guestSources}/`])
  }
  const jobs = Number.parseInt((await capture(["limactl", "shell", instance, "--", "nproc"])).trim(), 10) || 2
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
      console.log(`  = ${lang}.traineddata (cached, SHA ok)`)
      continue
    }
    await run(["curl", "-fSL", "--retry", "3", "--max-time", "300", `${pins.base}/${lang}.traineddata`, "-o", dest])
    const got = sha256File(dest)
    if (got !== pins.sha[lang]) {
      rmSync(dest, { force: true })
      throw new Error(`SHA256 mismatch for ${lang}.traineddata: want ${pins.sha[lang]}, got ${got}`)
    }
    console.log(`  ✓ ${lang}.traineddata (SHA ok)`)
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
      console.log(`  ✓ ${target}: layout + tessdata SHAs + fully static (execution verified at build time in guest)`)
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
      console.log(`  ✓ ${target}: layout + tessdata SHAs + arch/linkage evidence (not executable on this host)`)
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
    console.log(`  ✓ ${target}: layout + version + langs + blank-PNG OCR probe`)
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage:
  bun scripts/build-tools-tarballs.ts --out-dir <dir> [--only <t,...>] [--host-only] [--work-dir <dir>] [--force]

Builds spinosa-tools-<os>-<arch>.tar.gz from pinned source (local only, no CI).
darwin targets compile on this Mac; linux targets compile in Lima guests
(spinosa-tools-linux-arm64 / spinosa-tools-linux-x64 — see header).`)
    process.exit(0)
  }
  const root = path.resolve(import.meta.dir, "..")
  const outDir = path.resolve(root, argValue("--out-dir") ?? path.join("dist", "tools-local"))
  const onlyRaw = argValue("--only")
  const hostOnly = process.argv.includes("--host-only")
  const force = process.argv.includes("--force")
  const workDir =
    argValue("--work-dir") ?? path.join(tmpdir(), "spinosa-tools-build")
  const sourcesDir = path.join(workDir, "sources")
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

  const installSh = readFileSync(path.join(root, "install.sh"), "utf-8")
  const tessPins = parseTessdataPins(installSh)
  console.log(`tessdata commit ${tessPins.commit}`)
  mkdirSync(outDir, { recursive: true })

  console.log("→ sources (pinned, SHA256-verified)")
  await ensureSources(sourcesDir)

  for (const target of wanted) {
    const tarball = path.join(outDir, toolsTarballName(target))
    if (existsSync(tarball) && !force) {
      console.log(`→ ${target}: ${path.basename(tarball)} exists (use --force to rebuild)`)
      await verifyTarball(tarball, target, tessPins)
      continue
    }
    console.log(`→ ${target}: building tesseract ${TESSERACT_VERSION} from source`)
    const prefix = path.join(workDir, `prefix-${target}`)
    if (target.startsWith("darwin-")) {
      await buildDarwin(target, sourcesDir, prefix, workDir)
    } else {
      if (process.platform !== "darwin" && process.platform !== "linux") {
        throw new Error(`${target} needs limactl on macOS/Linux (this host is ${process.platform})`)
      }
      await buildLinuxViaLima(target, sourcesDir, prefix, workDir)
    }
    const stage = path.join(stageRoot, target)
    rmSync(stage, { recursive: true, force: true })
    mkdirSync(path.join(stage, "bin"), { recursive: true })
    const builtBin = path.join(prefix, "bin", "tesseract")
    if (!existsSync(builtBin)) throw new Error(`worker did not produce ${builtBin}`)
    await run(["cp", builtBin, path.join(stage, "bin", "tesseract")])
    chmodSync(path.join(stage, "bin", "tesseract"), 0o755)
    console.log(`→ ${target}: tessdata (pinned ${tessPins.commit.slice(0, 12)}…)`)
    await ensureTessdata(path.join(stage, "tessdata"), tessPins)
    rmSync(tarball, { force: true })
    await run(["tar", "-czf", tarball, "-C", stageRoot, target])
    const st = statSync(tarball)
    if (st.size < 1024 * 100) throw new Error(`tarball suspiciously small: ${tarball} (${st.size} bytes)`)
    console.log(`→ ${target}: verifying ${path.basename(tarball)}`)
    await verifyTarball(tarball, target, tessPins)
    console.log(`✓ ${target}: ${tarball} (${st.size} bytes, sha256 ${sha256File(tarball).slice(0, 16)}…)`)
  }

  const names = wanted.map(toolsTarballName)
  const stray = readdirSync(outDir).filter((f) => f.startsWith("spinosa-tools-") && !names.includes(f))
  if (stray.length > 0) console.log(`note: unrelated files in out-dir left alone: ${stray.join(", ")}`)
  console.log(`✓ tools tarballs → ${outDir}`)
}
