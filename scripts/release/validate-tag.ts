#!/usr/bin/env bun
/**
 * CI/local gate for tag-triggered beta releases.
 *
 * A pushed tag IS the release approval, so this validates it fail-closed:
 *   1. tag parses as `v<semver>` on the beta line (v1.1.0-beta.N[.M…])
 *   2. tag is semver-greater than every previous beta tag
 *   3. root package.json version equals the tag version
 *   4. CHANGELOG.md has a section for the tag version
 *
 * Usage:
 *   bun scripts/release/validate-tag.ts v1.1.0-beta.17.18
 *   bun scripts/release/validate-tag.ts v1.1.0-beta.17.18 --tags v1.1.0-beta.17.17,v1.1.0-beta.14
 *
 * Pure helpers are exported for unit tests.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { $ } from "bun"
import semver from "semver"
import { changelogHasVersionSection } from "../set-version.ts"
import { RELEASE_ROOT } from "./lib.ts"

export function cleanTag(tag: string): string | undefined {
  const clean = tag.replace(/^v/, "")
  return semver.valid(clean) ? clean : undefined
}

export function isBetaVersion(version: string): boolean {
  const pre = semver.prerelease(version)
  return !!pre && String(pre[0]) === "beta"
}

/** Greatest beta version among tags (without the leading v). */
export function previousBetaVersion(tags: string[]): string | undefined {
  const betas = tags
    .map((t) => t.trim().replace(/^v/, ""))
    .filter((v) => semver.valid(v) && isBetaVersion(v))
    .sort(semver.compare)
  return betas.at(-1)
}

export interface TagReleaseChecks {
  tag: string
  previousTags: string[]
  packageVersion: string
  changelog: string
}

/** Returns human-readable errors (empty = tag may release). */
export function validateTagRelease(checks: TagReleaseChecks): string[] {
  const errors: string[] = []
  const version = cleanTag(checks.tag)
  if (!version) {
    return [`tag ${checks.tag} is not v<semver> (want e.g. v1.1.0-beta.17.18)`]
  }
  if (!isBetaVersion(version)) {
    errors.push(`tag ${checks.tag} is not on the beta line (this gate releases betas only)`)
  }
  const previous = previousBetaVersion(checks.previousTags.filter((t) => t !== checks.tag))
  if (previous && semver.lte(version, previous)) {
    errors.push(`tag ${checks.tag} is not greater than previous beta v${previous} — tags must increase`)
  }
  const pkg = checks.packageVersion.replace(/^v/, "")
  if (pkg !== version) {
    errors.push(`package.json says ${pkg}, tag says ${version} — sync versions before tagging`)
  }
  if (!changelogHasVersionSection(checks.changelog, version)) {
    errors.push(`CHANGELOG.md missing section for v${version}`)
  }
  return errors
}

async function gitTags(): Promise<string[]> {
  const result = await $`git tag --list`.cwd(RELEASE_ROOT).nothrow().quiet()
  if (result.exitCode !== 0) return []
  return result.text().split("\n").map((s) => s.trim()).filter(Boolean)
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i < 0 ? undefined : process.argv[i + 1]
}

if (import.meta.main) {
  const tag = process.argv[2]
  if (!tag || tag === "--help" || tag === "-h") {
    console.log("Usage: bun scripts/release/validate-tag.ts v1.1.0-beta.17.18 [--tags a,b,c]")
    process.exit(tag ? 0 : 1)
  }
  const previousTags = argValue("--tags")?.split(",").map((s) => s.trim()).filter(Boolean)
    ?? await gitTags()
  const pkg = JSON.parse(readFileSync(resolve(RELEASE_ROOT, "package.json"), "utf-8")) as { version: string }
  const changelog = readFileSync(resolve(RELEASE_ROOT, "CHANGELOG.md"), "utf-8")
  const errors = validateTagRelease({ tag, previousTags, packageVersion: pkg.version, changelog })
  if (errors.length > 0) {
    for (const error of errors) console.error(`✗ ${error}`)
    process.exit(1)
  }
  console.log(`✓ tag ${tag} may release (greater than previous beta, version + changelog match)`)
}
