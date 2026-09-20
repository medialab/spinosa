import type { ChildProcess } from "node:child_process"
import type { GlobalEvent } from "@spinosa/sdk/v2"
import {
  bridgeJobLog,
  createJobId,
  emitJobCancelled,
  emitJobFinished,
  emitJobStarted,
  type JobEvent,
  type JobEventListener,
} from "@spinosa/core/progress/job-event"
import { ProgressEmitter } from "@spinosa/core/progress/progress"
import { JobRunner, type RegisteredJob } from "@spinosa/core/progress/job-runner"

export type PublishGlobalJobEvent = (input: {
  directory?: string
  workspace?: string
  event: JobEvent
}) => void | Promise<void>

export type ImportJobHandle = {
  jobId: string
  prog: ProgressEmitter
  onJobEvent: JobEventListener
  /** Real cancel flag backed by JobRunner (also true after cancel()). */
  shouldAbort: () => boolean
  /** Track OCR/other child processes so cancel() kills them. */
  registerChild: (child: ChildProcess) => void
  wrapLog: (onLog?: (msg: string) => void) => (msg: string) => void
  start: (kind?: string, title?: string) => void
  finish: (status?: "completed" | "error", summary?: string) => void
  /** Cancel-by-id: aborts work, kills children, publishes job.cancelled. */
  cancel: () => void
  registered: RegisteredJob
}

/**
 * Build a ProgressEmitter that dual-publishes to local listeners and job bus events,
 * and registers a real cancelable job on the process-local JobRunner.
 */
export function createImportJob(input: {
  kind?: string
  title?: string
  directory?: string
  workspace?: string
  /** Host callback that publishes onto GlobalBus (worker RPC or in-process). */
  publish?: PublishGlobalJobEvent
  /** Local TUI SDK emitter so in-process subscribers also see events immediately. */
  localEmit?: (event: GlobalEvent) => void
}): ImportJobHandle {
  const kind = input.kind ?? "import"
  const jobId = createJobId(kind)

  const onJobEvent: JobEventListener = (event) => {
    void input.publish?.({
      directory: input.directory,
      workspace: input.workspace,
      event,
    })
    input.localEmit?.({
      directory: input.directory ?? "global",
      workspace: input.workspace,
      payload: event as unknown as GlobalEvent["payload"],
    } as GlobalEvent)
  }

  const registered = JobRunner.register({
    jobId,
    kind,
    title: input.title,
  })

  const prog = new ProgressEmitter({ jobId, onJobEvent })

  return {
    jobId,
    prog,
    onJobEvent,
    shouldAbort: () => registered.shouldAbort(),
    registerChild: (child) => registered.registerChild(child),
    wrapLog: (onLog) => bridgeJobLog(jobId, onJobEvent, onLog),
    start: (k = kind, title = input.title) => emitJobStarted(onJobEvent, jobId, k, title),
    finish: (status = "completed", summary) => {
      registered.finish(status)
      emitJobFinished(onJobEvent, jobId, status, summary)
    },
    cancel: () => {
      registered.cancel()
      emitJobCancelled(onJobEvent, jobId)
    },
    registered,
  }
}
