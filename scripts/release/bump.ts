import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import semver from "semver"
import { releaseChannel, type ReleaseChannel } from "../../packages/spinosa-core/src/utils/version.ts"
import { RELEASE_ROOT } from "./lib.ts"

export type ReleaseIncrement = "patch" | "minor" | "major"

export function readCurrentVersion(root = RELEASE_ROOT): string {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8")) as { version: string }
  return pkg.version.replace(/^v/, "")
}

/** Match historical preRelease bump semantics (prerelease → next beta.N). */
export function planBump(current: string, channel: ReleaseChannel, increment: ReleaseIncrement): string {
  const version = current.replace(/^v/, "")
  if (!semver.valid(version)) {
    throw new Error(`Invalid current version: ${current}`)
  }

  if (channel === "beta") {
    if (increment === "minor") {
      if (semver.prerelease(version)) return semver.inc(version, "preminor", "beta")!
      return `${semver.inc(version, "minor")}-beta.0`
    }
    if (semver.prerelease(version)) return semver.inc(version, "prerelease", "beta")!
    return semver.inc(version, "prepatch", "beta")!
  }

  return semver.inc(version, increment)!
}

export function planRelease(channel: ReleaseChannel, increment: ReleaseIncrement, root = RELEASE_ROOT) {
  const current = readCurrentVersion(root)
  const next = planBump(current, channel, increment)
  return {
    current,
    next,
    channel: releaseChannel(next),
    tag: `v${next}`,
  }
}
