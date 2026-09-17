#!/usr/bin/env bun
import path from "node:path"
import { homedir } from "node:os"
import { writeYamlConfig } from "../packages/spinosa-core/src/utils/yaml-config.ts"
import { releaseChannel } from "../packages/spinosa-core/src/utils/version.ts"

const version = process.argv[2]
if (!version) {
  console.error("Usage: bun scripts/patch-local-install-metadata.ts <version>")
  process.exit(1)
}

const spinosaHome = process.env.SPINOSA_HOME ?? path.join(homedir(), ".spinosa")
const configPath = path.join(spinosaHome, "metadata", "config.yaml")
const channel = releaseChannel(version)

await writeYamlConfig(
  configPath,
  (document) => {
    document.set("spinosa", true)
    document.set("beta", channel === "beta")
    document.set("auto_upgrade", true)
    document.set("last_installed_version", version)
    document.delete("release_channel")
  },
  [
    "# Spinosa installation marker — do not remove",
    "spinosa: true",
    `beta: ${channel === "beta" ? "true" : "false"}`,
    "auto_upgrade: true",
    `last_installed_version: "${version}"`,
    "",
  ].join("\n"),
)

console.log(`  Updated ${configPath} → last_installed_version=${version}`)
