#!/usr/bin/env bun
import { $ } from "bun"
import type { ReleaseChannel } from "../../packages/spinosa-core/src/utils/version.ts"
import { planRelease, type ReleaseIncrement } from "./bump.ts"
import { RELEASE_ROOT, releasePaths } from "./lib.ts"
import { Reporter } from "./reporter.ts"
import { finalizeDistAssets, readCurrentVersion, runStage, type StageContext } from "./stages.ts"
import {
  findLatestState,
  initState,
  nextIncompleteStage,
  readState,
  STAGE_ORDER,
  stageLabel,
  stagesFrom,
  writeState,
  type StageName,
} from "./state.ts"

const HELP = `Spinosa release

Usage:
  bun run release beta patch [--dry-run]
  bun run release stable minor|patch|major [--dry-run]
  bun run release plan beta patch
  bun run release validate
  bun run release ci-assemble <version> [--dry-run] [--finalize-only]
  bun run release ci-publish <version>
  bun run release publish <version> [--from <stage>] [--dry-run]
  bun run release resume [version] [--dry-run]

Stages: ${STAGE_ORDER.map(stageLabel).join(", ")}
`

interface CliOptions {
  dryRun: boolean
  from?: StageName
  only?: StageName[]
  skipBump: boolean
  finalizeOnly?: boolean
}

function parseStage(value: string): StageName {
  const aliases: Record<string, StageName> = {
    preflight: "preflight",
    bump: "bump",
    build: "build",
    verifylocal: "verifyLocal",
    smoke: "smoke",
    gittag: "gitTag",
    publishversion: "publishVersion",
    channel: "channel",
    verifyremote: "verifyRemote",
  }
  const key = value.replaceAll("-", "").toLowerCase()
  const stage = aliases[key]
  if (!stage) {
    console.error(`Unknown stage: ${value}`)
    process.exit(1)
  }
  return stage
}

function parseOptions(args: string[]): { positionals: string[]; options: CliOptions } {
  const options: CliOptions = { dryRun: false, skipBump: false }
  const positionals: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--finalize-only") options.finalizeOnly = true
    else if (arg === "--from") options.from = parseStage(args[++index] ?? "")
    else if (arg === "--only") options.only = (args[++index] ?? "").split(",").map(parseStage)
    else if (arg === "--skip-bump") options.skipBump = true
    else positionals.push(arg)
  }
  return { positionals, options }
}

function resumeCommand(version: string, stage: StageName): string {
  return `bun run release resume ${version} --from ${stageLabel(stage)}`
}

async function gitSha(): Promise<string> {
  return (await $`git rev-parse HEAD`.cwd(RELEASE_ROOT).quiet()).text().trim()
}

async function runPipeline(version: string, options: CliOptions): Promise<void> {
  const reporter = new Reporter()
  const paths = releasePaths(version)
  const sha = await gitSha()
  let state = readState(version) ?? initState(version, sha)
  if (!options.dryRun) writeState(version, state)

  const start = options.from ?? (options.skipBump ? "build" : "preflight")
  let stages = stagesFrom(start)
  if (options.skipBump) stages = stages.filter((stage) => stage !== "bump")
  if (options.only) stages = stages.filter((stage) => options.only!.includes(stage))

  reporter.begin(version, paths.channel, options.dryRun)

  let ctx: StageContext = {
    version,
    paths,
    dryRun: options.dryRun,
    reporter,
    state,
    skipBump: options.skipBump,
  }

  for (const stage of stages) {
    try {
      ctx = await runStage(stage, ctx)
      if (stage === "bump" && !options.dryRun) {
        writeState(ctx.version, ctx.state)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      reporter.fail(stage, message, resumeCommand(ctx.version, stage))
    }
  }

  reporter.done()
}

async function commandValidate(): Promise<void> {
  const reporter = new Reporter()
  const version = readCurrentVersion()
  reporter.begin(version, "validate", false)
  const sha = await gitSha()
  const ctx: StageContext = {
    version,
    paths: releasePaths(version),
    dryRun: false,
    reporter,
    state: initState(version, sha),
    skipBump: true,
  }
  try {
    await runStage("preflight", ctx)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reporter.fail("preflight", message, "bun run release validate")
  }
  console.log("✓ Release validation passed")
}

async function commandPlan(channel: ReleaseChannel, increment: ReleaseIncrement): Promise<void> {
  const plan = planRelease(channel, increment)
  console.log(`Current:  v${plan.current}`)
  console.log(`Next:     v${plan.next}`)
  console.log(`Channel:  ${plan.channel}`)
  console.log(`Tag:      ${plan.tag}`)
  console.log(`\nRun: bun run release ${channel} ${increment}`)
}

async function commandRelease(channel: ReleaseChannel, increment: ReleaseIncrement, options: CliOptions): Promise<void> {
  const plan = planRelease(channel, increment)
  if (options.dryRun) {
    console.log(`[dry-run] would release v${plan.current} → v${plan.next} (${plan.channel})`)
  }
  await runPipeline(plan.next, { ...options, skipBump: false })
}

async function commandPublish(version: string, options: CliOptions): Promise<void> {
  await runPipeline(version.replace(/^v/, ""), { ...options, skipBump: true })
}

/**
 * CI assemble: finish a tag-triggered release from matrix artifacts.
 *
 * The workflow downloads one product binary + one tools tarball per target
 * into dist/v{version}/ and stages build-manifest.json via
 * build-release-binaries --manifest-only. This command verifies the tag
 * equals HEAD, finalizes dist/ (installers, manifest, checksums), then
 * runs verify-local → smoke. Publishing (publish-version → channel →
 * verify-remote) happens in `ci-publish`, which the workflow runs only after
 * every native verify job passes — a broken binary must never become the
 * rolling-channel default (v1.1.0-beta.19 outage).
 * Quality + tag validation run in earlier workflow jobs, not here.
 */
async function commandCiAssemble(
  versionArg: string,
  options: CliOptions & { finalizeOnly?: boolean },
): Promise<void> {
  const version = versionArg.replace(/^v/, "")
  const fail = (message: string): never => {
    console.error(`✗ ci-assemble: ${message}`)
    process.exit(1)
  }
  const head = (await $`git rev-parse HEAD`.cwd(RELEASE_ROOT).quiet()).text().trim()
  if (options.dryRun) {
    // Dry runs (workflow_dispatch) prove the pipeline without a pushed tag
    // and without remote mutations — but everything local runs FOR REAL
    // (finalize, verify-local, smoke) so a green dry-run predicts a green
    // publish. Missing dist/ assets fail here with a precise message.
    console.log(`  (dry-run: tag check skipped at ${head.slice(0, 8)}; remote steps print only)`)
  } else {
    const tagCheck = await $`git rev-list -1 v${version}`.cwd(RELEASE_ROOT).nothrow().quiet()
    if (tagCheck.exitCode !== 0) fail(`tag v${version} not found — CI assembles from a pushed tag`)
    const tagSha = tagCheck.text().trim()
    if (tagSha !== head) {
      fail(`tag v${version} points at ${tagSha.slice(0, 8)}, HEAD is ${head.slice(0, 8)} — tag the release commit`)
    }
  }
  if (readCurrentVersion() !== version) {
    fail(`package.json says v${readCurrentVersion()}, tag says v${version}`)
  }
  await finalizeDistAssets(releasePaths(version), version, (m) => console.log(`  ${m}`))
  if (options.dryRun) {
    // Real local stages first (fail closed on incomplete dist/), then
    // print-only remote stages.
    await runPipeline(version, {
      ...options,
      dryRun: false,
      from: "verifyLocal",
      only: ["verifyLocal", "smoke"],
      skipBump: true,
    })
    await runPipeline(version, { ...options, from: "gitTag", skipBump: true })
    return
  }
  if (options.finalizeOnly) {
    // Assemble job: finalize + local gates only. The workflow uploads dist/
    // and runs native verification on every platform before ci-publish.
    await runPipeline(version, {
      ...options,
      from: "verifyLocal",
      only: ["verifyLocal", "smoke"],
      skipBump: true,
    })
    return
  }
  await runPipeline(version, { ...options, from: "verifyLocal", skipBump: true })
}

/**
 * CI publish: create the immutable GitHub release and roll the channel.
 * Runs only after every native verify job passes (see release-beta.yml).
 */
async function commandCiPublish(versionArg: string, options: CliOptions): Promise<void> {
  const version = versionArg.replace(/^v/, "")
  const fail = (message: string): never => {
    console.error(`✗ ci-publish: ${message}`)
    process.exit(1)
  }
  const head = (await $`git rev-parse HEAD`.cwd(RELEASE_ROOT).quiet()).text().trim()
  const tagCheck = await $`git rev-list -1 v${version}`.cwd(RELEASE_ROOT).nothrow().quiet()
  if (tagCheck.exitCode !== 0) fail(`tag v${version} not found — CI publishes from a pushed tag`)
  const tagSha = tagCheck.text().trim()
  if (tagSha !== head) {
    fail(`tag v${version} points at ${tagSha.slice(0, 8)}, HEAD is ${head.slice(0, 8)} — tag the release commit`)
  }
  if (readCurrentVersion() !== version) {
    fail(`package.json says v${readCurrentVersion()}, tag says v${version}`)
  }
  await runPipeline(version, {
    ...options,
    from: "publishVersion",
    only: ["publishVersion", "channel", "verifyRemote"],
    skipBump: true,
  })
}

async function commandResume(versionArg: string | undefined, options: CliOptions): Promise<void> {
  const resolved = versionArg?.replace(/^v/, "") ?? findLatestState()?.version
  if (!resolved) {
    console.error("No release state found in dist/. Run a release first or pass a version.")
    process.exit(1)
  }
  const state = readState(resolved)
  if (!state) {
    console.error(`No release state found for v${resolved}`)
    process.exit(1)
  }
  const from = options.from ?? nextIncompleteStage(state)
  if (!from) {
    console.log(`v${resolved} is already complete`)
    return
  }
  await runPipeline(resolved, { ...options, from, skipBump: true })
}

async function main(): Promise<void> {
  const { positionals, options } = parseOptions(process.argv.slice(2))
  const [command, arg1, arg2] = positionals

  if (!command || command === "help" || command === "--help") {
    console.log(HELP)
    return
  }

  switch (command) {
    case "validate":
      await commandValidate()
      return
    case "plan":
      if (!arg1 || !arg2) {
        console.error("Usage: bun run release plan <beta|stable> <patch|minor|major>")
        process.exit(1)
      }
      await commandPlan(arg1 as ReleaseChannel, arg2 as ReleaseIncrement)
      return
    case "beta":
    case "stable":
      if (!arg1) {
        console.error(`Usage: bun run release ${command} <patch|minor${command === "stable" ? "|major" : ""}>`)
        process.exit(1)
      }
      await commandRelease(command, arg1 as ReleaseIncrement, options)
      return
    case "publish":
      if (!arg1) {
        console.error("Usage: bun run release publish <version>")
        process.exit(1)
      }
      await commandPublish(arg1, options)
      return
    case "ci-assemble":
      if (!arg1) {
        console.error("Usage: bun run release ci-assemble <version> [--dry-run] [--finalize-only]")
        process.exit(1)
      }
      await commandCiAssemble(arg1, options)
      return
    case "ci-publish":
      if (!arg1) {
        console.error("Usage: bun run release ci-publish <version>")
        process.exit(1)
      }
      await commandCiPublish(arg1, options)
      return
    case "resume":
      await commandResume(arg1, options)
      return
    default:
      console.error(`Unknown command: ${command}\n`)
      console.log(HELP)
      process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
