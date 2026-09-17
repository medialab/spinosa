import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { upgradeFramework, readEffectiveInstalledVersion } from "@spinosa/core/commands/upgrade"
import { isUpgrade } from "@spinosa/core/utils/version"
import {
  installUrlForChannel,
  spinosaReleaseChannel,
  type ReleaseChannel,
} from "@spinosa/core/system/channels"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "check for and install Spinosa updates",
  builder: (yargs: Argv) =>
    yargs
      .version(false)
      .positional("target", {
        describe: "target version (alias: --version)",
        type: "string",
      })
      .option("version", {
        describe: "target version to install (alias of the positional target)",
        type: "string",
      })
      .option("channel", {
        describe: "release channel (stable or beta)",
        type: "string",
        choices: ["stable", "beta"] as const,
      })
      .option("yes", {
        describe: "skip confirmation prompts",
        type: "boolean",
      })
      .option("reinstall", {
        describe: "reinstall the target version even if it matches the installed version",
        type: "boolean",
      })
      .option("allow-downgrade", {
        describe: "permit downgrading to an older version",
        type: "boolean",
      })
      .option("check", {
        describe: "check for updates without installing",
        type: "boolean",
      }),
  handler: async (args: {
    target?: string
    version?: string
    channel?: "stable" | "beta"
    yes?: boolean
    reinstall?: boolean
    allowDowngrade?: boolean
    check?: boolean
  }) => {
    UI.println(UI.logo(" "))
    UI.empty()
    prompts.intro("Spinosa updates")

    const currentVersion = readEffectiveInstalledVersion() || "unknown"
    prompts.log.info(`Current: v${currentVersion}`)

    if (args.check) {
      prompts.log.info("Checking for updates…")
    }

    const result = await upgradeFramework({
      version: args.version ?? args.target,
      channel: args.channel as ReleaseChannel | undefined,
      yes: args.yes,
      reinstall: args.reinstall,
      allowDowngrade: args.allowDowngrade,
      check: args.check,
      onPhase: (_phase, detail) => prompts.log.info(detail),
      confirm: async (question) => {
        if (args.yes) return true
        const answer = await prompts.confirm({ message: question, initialValue: true })
        if (prompts.isCancel(answer)) return false
        return answer === true
      },
    })

    if (args.check) {
      if (result.refusedReason) {
        prompts.log.warn(result.refusedReason)
      } else if (isUpgrade(result.previousVersion, result.newVersion)) {
        prompts.log.info(`Would update to v${result.newVersion}`)
      } else {
        const displayVersion = result.newVersion ?? currentVersion
        prompts.log.info(`Already up to date (v${displayVersion})`)
      }
      prompts.outro("Check complete.")
      return
    }

    if (result.refusedReason) {
      prompts.log.warn(result.refusedReason)
      prompts.outro("Upgrade refused.")
      return
    }

    if (!result.success) {
      prompts.log.error("Upgrade failed.")
      if (result.error) prompts.log.error(result.error)
      const effectiveChannel = (args.channel as ReleaseChannel | undefined) ?? (await spinosaReleaseChannel())
      const reinstallUrl = installUrlForChannel(effectiveChannel)
      const bootstrap = `curl -fsSL --connect-timeout 30 --max-time 600 --retry 3 --retry-delay 2 ${reinstallUrl} -o /tmp/spinosa-install.sh && bash /tmp/spinosa-install.sh`
      prompts.log.error(`Try reinstalling from ${reinstallUrl}`)
      prompts.log.error(`Or run: ${bootstrap}`)
      prompts.outro("Upgrade failed.")
      return
    }

    const alreadyCurrent =
      !!result.previousVersion &&
      !!result.newVersion &&
      result.previousVersion === result.newVersion &&
      !args.reinstall

    if (alreadyCurrent) {
      prompts.log.success(`Already at v${result.newVersion}`)
      prompts.outro("No upgrade needed.")
      return
    }

    prompts.log.success(`Upgraded to v${result.newVersion}`)
    prompts.outro("Restart Spinosa to use the new version.")
  },
}
