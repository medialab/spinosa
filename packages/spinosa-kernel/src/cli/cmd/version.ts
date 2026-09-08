import { InstallationVersion } from "@spinosa/kernel-core/installation/version"
import {
  isCompiledBinaryDistribution,
  compiledTemplatePackId,
  readCompiledDistribution,
} from "@spinosa/core/distribution/bootstrap"
import { getFormatFromRecord, emitResult } from "../output"

export const VersionCommand = {
  command: "version",
  describe: "Show the installed Spinosa version",
  builder: (yargs: import("yargs").Argv) =>
    yargs.option("json", { type: "boolean", describe: "Emit machine-readable JSON", default: false }),
  handler: async (args: Record<string, unknown>) => {
    const fmt = args.json ? "json" : getFormatFromRecord(args)
    const payload = {
      version: InstallationVersion,
      distribution: readCompiledDistribution(),
      templatePackId: isCompiledBinaryDistribution() ? compiledTemplatePackId() : undefined,
    }
    emitResult(fmt, "version", payload, `spinosa ${InstallationVersion}`)
  },
}
