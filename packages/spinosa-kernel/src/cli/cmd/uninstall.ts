import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Global } from "@spinosa/kernel-core/global"
import fs from "fs/promises"
import { existsSync } from "node:fs"
import {
  frameworkRuntimeTargets,
  launcherShimTargets,
  removeUninstallTargets,
  spinosaHome,
  validateSpinosaHome,
  verifySpinosaInstallMarker,
  type UninstallTarget,
} from "@spinosa/core/commands/uninstall"

interface UninstallArgs {
  keepConfig: boolean
  keepData: boolean
  dryRun: boolean
  yes: boolean
  force: boolean
}

export const UninstallCommand = {
  command: "uninstall",
  describe: "remove the Spinosa framework runtime and selected application data",
  builder: (yargs: Argv) =>
    yargs
      .option("yes", { alias: "y", type: "boolean", describe: "skip confirmation prompts", default: false })
      .option("force", { alias: "f", type: "boolean", describe: "alias for --yes", default: false })
      .option("keep-config", { alias: "c", type: "boolean", describe: "keep XDG configuration files", default: false })
      .option("keep-data", { alias: "d", type: "boolean", describe: "keep XDG session data and state", default: false })
      .option("dry-run", { type: "boolean", describe: "show what would be removed", default: false }),
  handler: async (args: UninstallArgs) => {
    UI.println(UI.logo(" "))
    UI.empty()
    prompts.intro("Uninstall Spinosa")

    const home = spinosaHome()
    const skipConfirm = args.yes || args.force
    const validationError = validateSpinosaHome(home)
    if (validationError) {
      prompts.log.error(`${validationError} (${home})`)
      prompts.outro("Aborted")
      process.exit(1)
    }
    const markerError = verifySpinosaInstallMarker(home)
    if (markerError) {
      prompts.log.error(markerError)
      prompts.outro("Aborted")
      process.exit(1)
    }

    const frameworkTargets: UninstallTarget[] = [
      ...frameworkRuntimeTargets(home),
      ...launcherShimTargets(),
    ]

    const xdgTargets = [
      { path: Global.Path.data, label: "Application data", keep: args.keepData },
      { path: Global.Path.cache, label: "Cache", keep: false },
      { path: Global.Path.config, label: "Configuration", keep: args.keepConfig },
      { path: Global.Path.state, label: "State", keep: args.keepData },
      { path: Global.Path.tmp, label: "Temporary files", keep: false },
    ]

    const present = await Promise.all(
      [...frameworkTargets.map((t) => ({ ...t, keep: false })), ...xdgTargets].map(async (target) => ({
        ...target,
        exists: existsSync(target.path) || (await fs.access(target.path).then(() => true).catch(() => false)),
      })),
    )

    for (const target of present) {
      if (target.exists) prompts.log.info(`${target.keep ? "keeping" : "removing"} ${target.label}: ${target.path}`)
    }

    if (!present.some((t) => t.exists && !t.keep)) {
      prompts.outro("Nothing to uninstall.")
      return
    }

    if (!skipConfirm && !args.dryRun) {
      const confirmed = await prompts.confirm({
        message: "Remove the Spinosa framework and selected application files? Workspace folders and ~/.spinosa/metadata/ are kept.",
      })
      if (prompts.isCancel(confirmed) || !confirmed) {
        prompts.outro("Cancelled")
        return
      }
    }

    if (args.dryRun) {
      prompts.outro("Dry run complete; no files were removed.")
      return
    }

    removeUninstallTargets(frameworkTargets)

    for (const target of present) {
      if (!target.exists || target.keep) continue
      if (frameworkTargets.some((f) => f.path === target.path)) continue
      await fs.rm(target.path, { recursive: true, force: true })
    }

    prompts.outro("Spinosa uninstalled. Workspace folders and ~/.spinosa/metadata/ were left in place.")
  },
}
