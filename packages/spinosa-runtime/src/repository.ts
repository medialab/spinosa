import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ResearchRun, ResearchRunEvent, WorkflowRun, WorkflowRunEvent } from "./model"
import { decodeWorkflowRun } from "./migration"
import { initialEvents } from "./state"

function runDirectory(workspacePath: string, runID: string): string {
  return path.join(workspacePath, ".spinosa", "runs", runID)
}

async function writeAtomic(target: string, data: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = path.join(path.dirname(target), ".run-" + process.pid + "-" + crypto.randomUUID())
  await writeFile(temporary, data, "utf8")
  await rename(temporary, target)
}

// In-process per-run write gate. File replacement is atomic but
// load→compute→save is not: two invocations (execute loop vs cancel, TUI
// facade vs service) can interleave so a stale non-terminal write clobbers
// a persisted cancellation. Every read-modify-write of run.json must run
// inside this gate with its terminal check against the fresh read, so the
// check and the write are one atomic segment. (Cross-process writers still
// race; all in-app writers share this module.)
const runGates = new Map<string, Promise<void>>()

export async function withRunLock<T>(workspacePath: string, runID: string, work: () => Promise<T>): Promise<T> {
  const key = `${workspacePath}\n${runID}`
  while (runGates.get(key) !== undefined) {
    await runGates.get(key)
  }
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  runGates.set(key, gate)
  try {
    return await work()
  } finally {
    release()
    runGates.delete(key)
  }
}

export class FileResearchRunRepository {
  async create(run: ResearchRun): Promise<void> {
    await this.save(run)
    for (const event of initialEvents(run)) await this.append(run.workspacePath, run.id, event)
  }

  async load(workspacePath: string, runID: string): Promise<ResearchRun | undefined> {
    try {
      return JSON.parse(await readFile(path.join(runDirectory(workspacePath, runID), "run.json"), "utf8")) as ResearchRun
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return
      throw error
    }
  }

  async save(run: ResearchRun): Promise<void> {
    const directory = runDirectory(run.workspacePath, run.id)
    await mkdir(directory, { recursive: true })
    await writeAtomic(path.join(directory, "run.json"), JSON.stringify(run, null, 2) + "\n")
  }

  async append(workspacePath: string, runID: string, event: ResearchRunEvent): Promise<void> {
    const directory = runDirectory(workspacePath, runID)
    await mkdir(directory, { recursive: true })
    await appendFile(path.join(directory, "events.jsonl"), JSON.stringify(event) + "\n", "utf8")
  }
}

// WP1: Versioned workflow repository. Same paths + atomic writes as legacy.
// decodeWorkflowRun() keeps old run.json files readable (see migration.ts).
export class FileWorkflowRunRepository {
  async create(run: WorkflowRun, events: readonly WorkflowRunEvent[] = []): Promise<void> {
    await this.save(run)
    for (const event of events) await this.append(run.workspacePath, run.id, event)
  }

  async load(workspacePath: string, runID: string): Promise<WorkflowRun | undefined> {
    try {
      const raw = JSON.parse(await readFile(path.join(runDirectory(workspacePath, runID), "run.json"), "utf8"))
      return decodeWorkflowRun(raw)
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return
      throw error
    }
  }

  async save(run: WorkflowRun): Promise<void> {
    await writeAtomic(
      path.join(runDirectory(run.workspacePath, run.id), "run.json"),
      JSON.stringify(run, null, 2) + "\n",
    )
  }

  async append(workspacePath: string, runID: string, event: WorkflowRunEvent): Promise<void> {
    const directory = runDirectory(workspacePath, runID)
    await mkdir(directory, { recursive: true })
    await appendFile(path.join(directory, "events.jsonl"), JSON.stringify(event) + "\n", "utf8")
  }
}
