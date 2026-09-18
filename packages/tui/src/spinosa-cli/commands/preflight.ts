export {
  // Launch preflight API — implemented in @spinosa/core/commands/preflight.
  LAUNCH_STATUS_CHECKING,
  LAUNCH_STATUS_LAUNCHING,
  LAUNCH_STATUS_NO_UPDATES,
  LAUNCH_STATUS_UPGRADE_DONE,
  offerStaleTemplatePackUpdates,
  printLaunchingTui,
  runLaunchPreflight,
  type LaunchPreflightOptions,
  type PreflightDependencies,
} from "@spinosa/core/commands/preflight"
