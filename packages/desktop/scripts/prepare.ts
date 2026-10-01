#!/usr/bin/env bun
/**
 * Sync the desktop package version with the Spinosa product version
 * (root `package.json`, per repo convention) before packaging.
 */
await import("./prebuild")

const rootPkg = await Bun.file("../package.json").json()
const version = rootPkg.version as string
if (!version) throw new Error("root package.json has no version")

const pkg = await Bun.file("./package.json").json()
pkg.version = version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${version}`)
