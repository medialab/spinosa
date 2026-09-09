#!/usr/bin/env bun
// Sync the product version across release-bearing files.
//
// Source of truth: root package.json + install.sh PINNED_VERSION.
// Also syncs Spinosa product packages on the 1.0.x-beta line.
//
// Intentionally NOT synced (keep upstream fork versioning, currently 1.17.x):
//   packages/spinosa-kernel, packages/tui, packages/core, and other @spinosa/*
//   packages that track the OpenCode fork line rather than the product version.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import semver from "semver"

/** Product packages that share root's 1.0.x(-beta) version line. */
export const PRODUCT_PACKAGE_DIRS = [
  "packages/spinosa-core",
  "packages/spinosa-cli",
  "packages/spinosa-harness",
  "packages/spinosa-runtime",
] as const

export function changelogHasVersionSection(changelog: string, version: string): boolean {
  const clean = version.replace(/^v/, "")
  // Match Keep a Changelog headings: ## [1.0.3-beta.1] or ## [1.0.3-beta.1] — 2026-07-30
  const pattern = new RegExp(
    `^## \\[${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\](?:\\s|[—–-]|$)`,
    "m",
  )
  return pattern.test(changelog)
}

export function assertChangelogHasVersion(root: string, version: string): void {
  const changelogPath = resolve(root, "CHANGELOG.md")
  if (!existsSync(changelogPath)) {
    throw new Error(`CHANGELOG.md not found at ${changelogPath}`)
  }
  const changelog = readFileSync(changelogPath, "utf-8")
  const clean = version.replace(/^v/, "")
  if (!changelogHasVersionSection(changelog, clean)) {
    throw new Error(
      `CHANGELOG.md missing section for v${clean}. Add a heading like \`## [${clean}] - YYYY-MM-DD\` before releasing.`,
    )
  }
}

function syncPackageVersion(pkgPath: string, version: string): boolean {
  if (!existsSync(pkgPath)) return false
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string }
  if (pkg.version === version) return false
  pkg.version = version
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  return true
}

export function syncProductVersion(version: string, root: string): {
  previous: string
  syncedPackages: string[]
} {
  const clean = version.replace(/^v/, "")
  if (!semver.valid(clean)) {
    throw new Error(`Invalid semantic version: ${clean}`)
  }

  assertChangelogHasVersion(root, clean)

  const pkgPath = resolve(root, "package.json")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }
  const previous = pkg.version
  pkg.version = clean
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

  const installPath = resolve(root, "install.sh")
  if (!existsSync(installPath)) throw new Error(`Installer not found: ${installPath}`)
  let installScript = readFileSync(installPath, "utf-8")
  const pinRegex = /^PINNED_VERSION="([^"]+)"/m
  if (!pinRegex.test(installScript)) throw new Error("PINNED_VERSION line not found in install.sh")
  installScript = installScript.replace(pinRegex, `PINNED_VERSION="${clean}"`)
  writeFileSync(installPath, installScript)

  // Kernel/tui/core and other 1.17.x packages keep their own upstream fork versions.
  const syncedPackages: string[] = []
  for (const dir of PRODUCT_PACKAGE_DIRS) {
    const path = resolve(root, dir, "package.json")
    if (syncPackageVersion(path, clean)) syncedPackages.push(dir)
  }

  return { previous, syncedPackages }
}

function main() {
  const version = process.argv[2]
  if (!version) {
    console.error("Usage: bun scripts/set-version.ts <version>")
    process.exit(1)
  }

  const root = resolve(import.meta.dir, "..")
  const { previous, syncedPackages } = syncProductVersion(version, root)
  console.log(`✓ Synchronized product version: v${previous} → v${version.replace(/^v/, "")}`)
  if (syncedPackages.length > 0) {
    console.log(`✓ Synced package versions: ${syncedPackages.join(", ")}`)
  }
}

if (import.meta.main) main()
