import { expect, test, vi } from "bun:test"
import { createRoot } from "solid-js"
import type { OnboardingJobGetResponse } from "@spinosa/sdk/v2/client"
import { createBackgroundImportStatus } from "./spinosa-background-import"

const job = (status: OnboardingJobGetResponse["status"]): OnboardingJobGetResponse => ({
  id: "job-1", status, phase: "import", message: status,
  workspacePath: "/workspaces/notes", current: 1, total: 1,
  activeFile: "/sources/notes/file.txt", logs: ["Imported file"],
  files: [{ relPath: "notes/file.txt", status: "imported" }],
  result: { success: true, imported: 1, recovered: 0, failed: 0, stillMissing: 0 },
})

for (const finalStatus of ["completed", "failed"] as const) test(`keeps a ${finalStatus} import after five seconds`, async () => {
  vi.useFakeTimers()
  const owned = createRoot((dispose) => ({
    dispose,
    status: createBackgroundImportStatus(async () => job("running"), async () => job(finalStatus)),
  }))
  try {
    await Promise.resolve()
    vi.advanceTimersByTime(1_000)
    await Promise.resolve()
    expect(owned.status.job()?.status).toBe(finalStatus)
    vi.advanceTimersByTime(5_001)
    expect(owned.status.job()?.status).toBe(finalStatus)
    expect(owned.status.job()?.activeFile).toBe("/sources/notes/file.txt")
    owned.status.dismiss()
    expect(owned.status.job()).toBeUndefined()
  } finally {
    owned.dispose()
    vi.useRealTimers()
  }
})

test("retains the last snapshot through a poll error and retries", async () => {
  vi.useFakeTimers()
  let calls = 0
  const owned = createRoot((dispose) => ({
    dispose,
    status: createBackgroundImportStatus(async () => job("running"), async () => {
      calls++
      if (calls === 1) throw new Error("temporary outage")
      return job("completed")
    }),
  }))
  try {
    await Promise.resolve()
    vi.advanceTimersByTime(1_000)
    await Promise.resolve()
    expect(owned.status.job()?.status).toBe("running")
    expect(owned.status.pollError()).toBeTruthy()
    vi.advanceTimersByTime(1_000)
    await Promise.resolve()
    expect(calls).toBe(2)
    expect(owned.status.job()?.status).toBe("completed")
    expect(owned.status.pollError()).toBeUndefined()
  } finally {
    owned.dispose()
    vi.useRealTimers()
  }
})

test("shows a terminal job returned on initial load without polling", async () => {
  vi.useFakeTimers()
  let polls = 0
  const owned = createRoot((dispose) => ({
    dispose,
    status: createBackgroundImportStatus(async () => job("failed"), async () => {
      polls++
      return job("failed")
    }),
  }))
  try {
    await Promise.resolve()
    vi.advanceTimersByTime(6_000)
    expect(owned.status.job()?.status).toBe("failed")
    expect(polls).toBe(0)
  } finally {
    owned.dispose()
    vi.useRealTimers()
  }
})
