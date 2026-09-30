#!/usr/bin/env bun
/**
 * Guards the invariant that `RELEASE_GUIDE.md` and `AGENTS.md` state in prose:
 * tag-triggered workflows run from the DEFAULT BRANCH, so the copy reviewed on a
 * feature branch is not the copy that ships unless the two are identical.
 *
 * Fails when a synced workflow differs from the default branch's copy. Run from
 * `bun run quality`.
 */
import { $ } from "bun"
import { readFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")

/** Workflows that must be byte-identical on the default branch. */
export const SYNCED_WORKFLOWS = [".github/workflows/release-beta.yml"] as const

/** Ignore line-ending and trailing-whitespace noise; everything else is drift. */
export function normalizeWorkflow(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n+$/, "\n")
}

export function workflowDrift(input: { file: string; local: string; remote: string }): string | undefined {
  if (normalizeWorkflow(input.local) === normalizeWorkflow(input.remote)) return undefined
  return `${input.file} differs from the default branch copy — tag releases run the default branch's version`
}

async function git(...args: string[]): Promise<{ ok: boolean; text: string }> {
  const result = await $`git ${args}`.cwd(root).nothrow().quiet()
  return { ok: result.exitCode === 0, text: result.text() }
}

async function defaultBranch(): Promise<string> {
  const symbolic = await git("symbolic-ref", "--quiet", "refs/remotes/origin/HEAD")
  const name = symbolic.ok ? symbolic.text.trim().replace("refs/remotes/origin/", "") : ""
  return name || "main"
}

/** Default-branch copy of `file`, or undefined when it cannot be retrieved. */
async function remoteCopy(branch: string, file: string): Promise<string | undefined> {
  const tracked = await git("show", `origin/${branch}:${file}`)
  if (tracked.ok) return tracked.text
  // Shallow CI checkouts have no origin/<branch> ref: fetch just that commit.
  const fetched = await git("fetch", "--depth=1", "--quiet", "origin", branch)
  if (!fetched.ok) return undefined
  const afterFetch = await git("show", `FETCH_HEAD:${file}`)
  return afterFetch.ok ? afterFetch.text : undefined
}

if (import.meta.main) {
  const branch = await defaultBranch()
  const current = (await git("rev-parse", "--abbrev-ref", "HEAD")).text.trim()

  if (current === branch) {
    console.log(`workflow-sync: on ${branch}; nothing to compare`)
    process.exit(0)
  }

  const drifted: string[] = []
  for (const file of SYNCED_WORKFLOWS) {
    const remote = await remoteCopy(branch, file)
    if (remote === undefined) {
      const message = `workflow-sync: could not read ${file} from origin/${branch}`
      // Fail closed in CI; a local offline run cannot prove sync either way.
      if (process.env.CI) {
        console.error(`${message} — cannot prove the shipped pipeline matches this branch`)
        process.exit(1)
      }
      console.warn(`${message} (offline?) — skipping`)
      continue
    }
    const drift = workflowDrift({ file, local: readFileSync(path.join(root, file), "utf-8"), remote })
    if (drift) drifted.push(drift)
  }

  if (drifted.length > 0) {
    for (const message of drifted) console.error(`workflow-sync: ${message}`)
    console.error(`workflow-sync: reconcile with 'git checkout ${branch} -- ${SYNCED_WORKFLOWS.join(" ")}'`)
    process.exit(1)
  }

  console.log(`workflow-sync: in sync with origin/${branch}`)
}
