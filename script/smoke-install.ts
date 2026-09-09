#!/usr/bin/env bun
/**
 * Install / launch smoke — mirrors what end users get from install.sh.
 *
 * Modes:
 *   (default / --repo-root)  Live checkout: kernel version + doctor + cwd resolution
 *   --dist <dir>             Binary installer smoke via temporary HTTP server
 *   --binary <path>          Direct product-binary smoke (remote host download path)
 *
 * Binary installer contract:
 *   SPINOSA_RELEASE_BASE_URL — base URL for immutable assets (install.sh, binaries,
 *   checksums.txt, build-manifest.json). install.sh downloads from
 *   `${SPINOSA_RELEASE_BASE_URL}/<asset>` when set (used by --dist local HTTP smoke).
 *   If the host binary is missing from --dist, deep install/version checks are skipped.
 *
 * Usage:
 *   bun script/smoke-install.ts
 *   bun script/smoke-install.ts --repo-root
 *   bun script/smoke-install.ts --dist dist/vX.Y.Z
 *   bun script/smoke-install.ts --binary dist/vX.Y.Z/spinosa-darwin-arm64
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { $ } from "bun"
import {
  HOME_LAYOUT,
  productBinaryAssetName,
  resolveProductBinaryTarget,
} from "../packages/spinosa-core/src/distribution/contract.ts"
import { buildKernelBunArgv } from "../packages/spinosa-core/src/system/bun-launch.ts"

const root = path.resolve(import.meta.dir, "..")

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

const distDir = argValue("--dist")
const binaryPath = argValue("--binary")
const explicitRepo = process.argv.includes("--repo-root")
const structureOnly =
  process.argv.includes("--structure") ||
  process.env.SPINOSA_SMOKE_STRUCTURE === "1"

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage:
  bun script/smoke-install.ts                              # live checkout
  bun script/smoke-install.ts --repo-root                  # same
  bun script/smoke-install.ts --dist <release-dir>         # binary installer via local HTTP
  bun script/smoke-install.ts --binary <product-binary>    # direct binary version/doctor
Env:
  SPINOSA_SMOKE_STRUCTURE=1     structure / asset checks only
  SPINOSA_RELEASE_BASE_URL      honored by rewritten install.sh (set by --dist)`)
  process.exit(0)
}

const modes = [distDir ? "dist" : null, binaryPath ? "binary" : null, explicitRepo ? "repo" : null].filter(Boolean)
if (modes.length > 1) {
  console.error("Use only one of --dist, --binary, or --repo-root")
  process.exit(1)
}

const home = mkdtempSync(path.join(tmpdir(), "spinosa-smoke-home-"))
const project = mkdtempSync(path.join(tmpdir(), "spinosa-smoke-project-"))
writeFileSync(path.join(project, "README.md"), "# smoke project\n")
const cleanup: string[] = [home, project]

function hostBinaryName(): string {
  return productBinaryAssetName(
    resolveProductBinaryTarget({ os: process.platform, arch: process.arch }),
  )
}

async function smokeBinary(bin: string, label: string): Promise<void> {
  if (!existsSync(bin)) throw new Error(`${label} not found: ${bin}`)
  chmodSync(bin, 0o755)
  if (structureOnly) {
    const st = statSync(bin)
    if (st.size <= 0) throw new Error(`${label} empty`)
    if ((st.mode & 0o111) === 0) throw new Error(`${label} not executable`)
    console.log(`✓ ${label} structure ok (${st.size} bytes)`)
    return
  }

  const env = { ...process.env, SPINOSA_HOME: home }
  for (const cmd of ["version", "doctor"] as const) {
    console.log(`→ smoke ${cmd} (${label})`)
    const result = await $`${bin} ${cmd}`.cwd(project).env(env).nothrow()
    if (result.exitCode !== 0) {
      throw new Error(`smoke ${cmd} failed with exit ${result.exitCode}`)
    }
  }
  console.log(`✓ binary smoke passed (${label})`)
}

async function serveDist(dir: string): Promise<{ baseUrl: string; stop: () => void }> {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      let rel = decodeURIComponent(url.pathname.replace(/^\//, ""))
      if (!rel || rel.endsWith("/")) rel = path.posix.join(rel, "install.sh")
      const abs = path.resolve(dir, rel)
      if (!abs.startsWith(path.resolve(dir) + path.sep) && abs !== path.resolve(dir)) {
        return new Response("forbidden", { status: 403 })
      }
      const file = Bun.file(abs)
      if (!(await file.exists())) return new Response("not found", { status: 404 })
      return new Response(file)
    },
  })
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  }
}

async function smokeDist(dist: string): Promise<void> {
  if (!existsSync(dist)) throw new Error(`dist not found: ${dist}`)
  const installSh = path.join(dist, "install.sh")
  const checksums = path.join(dist, "checksums.txt")
  if (!existsSync(installSh)) throw new Error(`missing ${installSh}`)
  if (!existsSync(checksums)) throw new Error(`missing ${checksums}`)

  console.log("→ release asset structure")
  const hostName = hostBinaryName()
  const hostBinary = path.join(dist, hostName)
  const hasHostBinary = existsSync(hostBinary)
  if (!hasHostBinary) {
    console.warn(
      `host binary ${hostName} missing — deep installer/binary smoke will be skipped`,
    )
  } else {
    const st = statSync(hostBinary)
    if (st.size <= 0) throw new Error(`host binary empty: ${hostBinary}`)
  }
  console.log("✓ release asset structure")

  if (structureOnly) {
    console.log(`✓ smoke passed (structure-only, dist=${dist})`)
    return
  }

  const { baseUrl, stop } = await serveDist(dist)
  try {
    console.log(`→ local release HTTP ${baseUrl}`)
    console.log("→ install.sh --yes --no-launch (SPINOSA_RELEASE_BASE_URL)")
    const install = await $`bash ${installSh} --yes --no-launch`
      .cwd(project)
      .env({
        ...process.env,
        HOME: home,
        SPINOSA_HOME: path.join(home, ".spinosa"),
        SPINOSA_RELEASE_BASE_URL: baseUrl,
        // Documented contract for the install.sh rewrite; legacy installers ignore this.
      })
      .nothrow()

    const installedBin = path.join(home, ".spinosa", HOME_LAYOUT.binDir, HOME_LAYOUT.binaryName)
    if (install.exitCode === 0 && existsSync(installedBin)) {
      await smokeBinary(installedBin, "installed binary")
      console.log(
        "note: workspace create smoke skipped here — release smoke covers install + version/doctor",
      )
      return
    }

    const stdoutTail = install.stdout ? String(install.stdout).slice(-2000) : ""
    const stderrTail = install.stderr ? String(install.stderr).slice(-2000) : ""
    if (stdoutTail) console.error(`installer stdout tail:\n${stdoutTail}`)
    if (stderrTail) console.error(`installer stderr tail:\n${stderrTail}`)

    throw new Error(
      `installer smoke failed: install.sh exited ${install.exitCode} and installed binary missing under ${installedBin} — gate must fail without binary-copy fallback`,
    )
  } finally {
    stop()
  }
}

async function smokeRepoRoot(): Promise<void> {
  const frameworkRoot = root
  const kernelEntry = path.join(frameworkRoot, "packages/spinosa-kernel/src/index.ts")
  if (!existsSync(kernelEntry)) throw new Error(`missing kernel entry: ${kernelEntry}`)

  const env = {
    ...process.env,
    SPINOSA_HOME: home,
    SPINOSA_TEMPLATE_ROOT: frameworkRoot,
    PWD: project,
  }

  for (const cmd of ["version", "doctor"] as const) {
    console.log(`→ smoke ${cmd}`)
    const argv = buildKernelBunArgv({
      bunPath: process.execPath,
      frameworkRoot,
      kernelEntry,
      args: [cmd],
    })
    const result = await $`${argv}`.cwd(project).env(env).nothrow()
    if (result.exitCode !== 0) {
      throw new Error(`smoke ${cmd} failed with exit ${result.exitCode}`)
    }
  }

  const { resolveThreadDirectory } = await import(
    "../packages/spinosa-kernel/src/cli/cmd/tui.ts"
  )
  const resolved = resolveThreadDirectory(undefined, project, frameworkRoot)
  const expected = realpathSync(project)
  if (resolved !== expected) {
    throw new Error(`expected project cwd ${expected}, got ${resolved}`)
  }

  console.log(`✓ smoke passed (framework=${frameworkRoot}, project=${project})`)
}

try {
  if (distDir) await smokeDist(path.resolve(distDir))
  else if (binaryPath) await smokeBinary(path.resolve(binaryPath), "product binary")
  else await smokeRepoRoot()
} finally {
  for (const dir of cleanup) {
    rmSync(dir, { recursive: true, force: true })
  }
}
