#!/usr/bin/env bun
/**
 * Build-once promotion for CI releases (beta and stable).
 *
 * The real release never rebuilds: it downloads the `assembled-dist`
 * artifact from the newest green dry-run built from the exact tag commit,
 * verifies its layout + checksums, and hands `dist/` to `ci-publish`.
 * A tag with no green dry-run fails closed instead of rebuilding.
 *
 * Commit binding uses artifact CONTENT, not run metadata: dispatch runs
 * report the default branch's SHA (where the workflow file lives), not the
 * checked-out source branch they actually built. So the assemble job
 * writes `dist/commit-sha.txt` (also uploaded alone as `release-sha`), and
 * promotion matches that embedded SHA against the tag commit.
 *
 * Version binding needs no extra check: dry-runs run validate-tag, which
 * forces the dispatch version to equal the tree's package.json — and the
 * real tag must equal package.json too. Same SHA therefore implies same
 * version; the layout check below pins the `dist/v<tag-version>/` dir.
 *
 * Usage:
 *   bun scripts/release/promote.ts 1.1.0-beta.31
 *   bun scripts/release/promote.ts 1.2.0
 *
 * Pure helpers are exported for unit tests (no network there).
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"
import { productBinaryAssetName, PRODUCT_BINARY_TARGETS } from "../../packages/spinosa-core/src/distribution/contract.ts"
import { RELEASE_ROOT } from "./lib.ts"

export const RELEASE_WORKFLOW = "release-beta.yml"

export function dryRunHint(version: string): string {
  const pre = version.includes("-beta")
  const branch = pre ? "beta-dev" : "main"
  return `gh workflow run ${RELEASE_WORKFLOW} -f version=${version} -f dry_run=true (checks out ${branch})`
}

export interface DryRunRecord {
  id: number
  createdAt: string
}

/** A dry-run with its embedded build-commit SHA resolved. */
export interface ResolvedDryRun {
  id: number
  buildSha: string
}

/** Newest run whose embedded build SHA equals the tag commit. */
export function selectPromotionRun(runs: ResolvedDryRun[], sha: string): ResolvedDryRun | undefined {
  const want = sha.toLowerCase()
  const matches = runs.filter((r) => r.buildSha.toLowerCase() === want)
  if (matches.length === 0) return undefined
  return [...matches].sort((a, b) => b.id - a.id)[0]
}

const REQUIRED_TOP_FILES = ["install.sh", "checksums.txt", "build-manifest.json"] as const

/** Fail-closed layout + checksum verification of a promoted dist/ tree. */
export async function verifyPromotedDist(distRoot: string, version: string): Promise<void> {
  const dir = join(distRoot, `v${version}`)
  if (!existsSync(dir)) throw new Error(`promoted dist missing ${dir} — wrong dry-run artifact?`)
  const names = new Set(readdirSync(dir))
  const expected = [...REQUIRED_TOP_FILES, ...PRODUCT_BINARY_TARGETS.map(productBinaryAssetName)]
  const missing = expected.filter((f) => !names.has(f))
  if (missing.length > 0) {
    throw new Error(`promoted dist v${version} missing: ${missing.join(", ")}`)
  }
  // checksums.txt pins every immutable asset: hash everything it lists.
  const lines = readFileSync(join(dir, "checksums.txt"), "utf-8").split("\n")
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/)
    if (!match) continue
    const [, want, rel] = match
    const abs = join(dir, rel)
    if (!existsSync(abs)) throw new Error(`promoted checksums.txt lists missing file: ${rel}`)
    const got = createHash("sha256").update(readFileSync(abs)).digest("hex")
    if (got !== want) throw new Error(`promoted checksum mismatch: ${rel}`)
  }
}

async function ghApi(path: string): Promise<unknown> {
  const result = await $`gh api ${path}`.cwd(RELEASE_ROOT).nothrow().quiet()
  if (result.exitCode !== 0) {
    throw new Error(`gh api failed: ${String(result.text()).slice(0, 300)}`)
  }
  return JSON.parse(result.text())
}

if (import.meta.main) {
  const version = (process.argv[2] ?? "").replace(/^v/, "")
  if (!version) {
    console.error("Usage: bun scripts/release/promote.ts <version> (e.g. 1.2.0 or 1.1.0-beta.31)")
    process.exit(1)
  }
  const fail = (message: string): never => {
    console.error(`✗ promote: ${message}`)
    process.exit(1)
  }
  const head = (await $`git rev-parse HEAD`.cwd(RELEASE_ROOT).quiet()).text().trim()
  const repo = process.env.GITHUB_REPOSITORY
    ?? (await $`gh repo view --json nameWithOwner --jq .nameWithOwner`.cwd(RELEASE_ROOT).nothrow().quiet()).text().trim()
  if (!repo || !repo.includes("/")) fail("cannot determine owner/repo (need GITHUB_REPOSITORY or gh auth)")
  const data = (await ghApi(
    `repos/${repo}/actions/workflows/${RELEASE_WORKFLOW}/runs?event=workflow_dispatch&status=success&per_page=10`,
  ).catch((e) => fail(String(e)))) as { workflow_runs?: Array<{ id: number; created_at: string }> }
  // Resolve each candidate's embedded build SHA via its tiny release-sha
  // artifact (dispatch head_sha is the default branch, not the built commit).
  const resolved: ResolvedDryRun[] = []
  for (const run of (data.workflow_runs ?? []).slice(0, 10)) {
    const shaDir = join(RELEASE_ROOT, ".promote-tmp", String(run.id))
    mkdirSync(shaDir, { recursive: true })
    const dl = await $`gh run download ${run.id} --repo ${repo} -n release-sha -D ${shaDir}`.cwd(RELEASE_ROOT).nothrow().quiet()
    if (dl.exitCode !== 0) continue
    const file = join(shaDir, "commit-sha.txt")
    if (!existsSync(file)) continue
    resolved.push({ id: run.id, buildSha: readFileSync(file, "utf-8").trim() })
  }
  await $`rm -rf ${join(RELEASE_ROOT, ".promote-tmp")}`.cwd(RELEASE_ROOT).nothrow().quiet()
  const pick = selectPromotionRun(resolved, head)
  if (!pick) {
    fail(
      `no green dry-run built from commit ${head.slice(0, 8)} — dispatch one first: ` +
        dryRunHint(version),
    )
  }
  console.log(`promoting dry-run ${pick.id} (built from ${head.slice(0, 8)})`)
  const dest = join(RELEASE_ROOT, "dist")
  mkdirSync(dest, { recursive: true })
  const dl = await $`gh run download ${pick.id} --repo ${repo} -n assembled-dist -D ${dest}`.cwd(RELEASE_ROOT).nothrow()
  if (dl.exitCode !== 0) {
    fail(`downloading assembled-dist from run ${pick.id} failed: ${String(dl.text()).slice(0, 500)}`)
  }
  await verifyPromotedDist(dest, version).catch((e) => fail(e instanceof Error ? e.message : String(e)))
  console.log(`✓ promoted exact dry-run bytes for v${version} (run ${pick.id})`)
}
