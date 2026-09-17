#!/usr/bin/env bun
/**
 * Compare two semver strings for install.sh compatibility.
 * Exit codes: 0 = equal, 1 = left newer, 2 = right newer.
 */
import semver from "semver"
import { normalizeFrameworkVersion } from "../packages/spinosa-core/src/utils/version.ts"

const left = normalizeFrameworkVersion(process.argv[2])
const right = normalizeFrameworkVersion(process.argv[3])

if (!left || !right) {
  console.error("Usage: bun scripts/compare-versions.ts <left> <right>")
  process.exit(3)
}

if (left === right) process.exit(0)

if (!semver.valid(left) || !semver.valid(right)) {
  console.error(`Invalid semver: left=${left} right=${right}`)
  process.exit(3)
}

const cmp = semver.compare(left, right)
if (cmp > 0) process.exit(1)
if (cmp < 0) process.exit(2)
process.exit(0)
