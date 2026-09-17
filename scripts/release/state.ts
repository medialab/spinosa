import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import semver from "semver"
import { releaseChannel } from "../../packages/spinosa-core/src/utils/version.ts"
import { RELEASE_ROOT } from "./lib.ts"

export const STAGE_ORDER = [
  "preflight",
  "bump",
  "build",
  "verifyLocal",
  "smoke",
  "gitTag",
  "publishVersion",
  "channel",
  "verifyRemote",
] as const

export type StageName = (typeof STAGE_ORDER)[number]

export type StageStatus = "ok" | "failed" | "skipped"

export interface StageRecord {
  status: StageStatus
  at: string
  durationMs?: number
  detail?: string
  error?: string
}

export interface ReleaseState {
  version: string
  channel: ReturnType<typeof releaseChannel>
  sha: string
  startedAt: string
  updatedAt: string
  stages: Partial<Record<StageName, StageRecord>>
}

export function statePath(version: string): string {
  return resolve(RELEASE_ROOT, `dist/v${version}`, ".release-state.json")
}

export function readState(version: string): ReleaseState | undefined {
  const file = statePath(version)
  if (!existsSync(file)) return undefined
  return JSON.parse(readFileSync(file, "utf-8")) as ReleaseState
}

export function writeState(version: string, state: ReleaseState): void {
  const file = statePath(version)
  mkdirSync(resolve(file, ".."), { recursive: true })
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`)
}

export function initState(version: string, sha: string): ReleaseState {
  const now = new Date().toISOString()
  return {
    version,
    channel: releaseChannel(version),
    sha,
    startedAt: now,
    updatedAt: now,
    stages: {},
  }
}

export function markStage(
  state: ReleaseState,
  stage: StageName,
  record: Omit<StageRecord, "at"> & { at?: string },
): ReleaseState {
  const next = {
    ...state,
    updatedAt: new Date().toISOString(),
    stages: {
      ...state.stages,
      [stage]: {
        at: record.at ?? new Date().toISOString(),
        status: record.status,
        durationMs: record.durationMs,
        detail: record.detail,
        error: record.error,
      },
    },
  }
  writeState(state.version, next)
  return next
}

export function findLatestState(): { version: string; state: ReleaseState } | undefined {
  const dist = resolve(RELEASE_ROOT, "dist")
  if (!existsSync(dist)) return undefined

  const candidates = readdirSync(dist)
    .filter((entry) => entry.startsWith("v"))
    .map((entry) => entry.slice(1))
    .filter((version) => existsSync(statePath(version)))

  if (candidates.length === 0) return undefined

  const sorted = candidates.sort((left, right) => {
    const cmp = semverCompare(left, right)
    return cmp ?? 0
  })
  const version = sorted.at(-1)!
  const state = readState(version)
  return state ? { version, state } : undefined
}

function semverCompare(left: string, right: string): number | undefined {
  const clean = (value: string) => value.replace(/^v/, "")
  if (!semver.valid(clean(left)) || !semver.valid(clean(right))) return undefined
  return semver.compare(clean(left), clean(right))
}

export function nextIncompleteStage(state: ReleaseState): StageName | undefined {
  for (const stage of STAGE_ORDER) {
    if (state.stages[stage]?.status !== "ok") return stage
  }
  return undefined
}

export function stagesFrom(from: StageName): StageName[] {
  const index = STAGE_ORDER.indexOf(from)
  if (index < 0) throw new Error(`Unknown stage: ${from}`)
  return STAGE_ORDER.slice(index)
}

export function stageLabel(stage: StageName): string {
  switch (stage) {
    case "preflight": return "preflight"
    case "bump": return "bump"
    case "build": return "build"
    case "verifyLocal": return "verify-local"
    case "smoke": return "smoke"
    case "gitTag": return "git-tag"
    case "publishVersion": return "publish-version"
    case "channel": return "channel"
    case "verifyRemote": return "verify-remote"
  }
}
