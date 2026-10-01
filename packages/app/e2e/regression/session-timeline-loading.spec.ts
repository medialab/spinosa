import { expect, test } from "../utils/diagnostic-test"
import { base64Encode } from "@spinosa/kernel-core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"

test("shows transcript loading until the initial message page arrives", async ({ page }) => {
  const directory = "C:/OpenCode/SessionTimelineLoading"
  const sessionID = "ses_session_timeline_loading"
  let finishMessages!: () => void
  let messagesStarted!: () => void
  const pendingMessages = new Promise<void>((resolve) => {
    finishMessages = resolve
  })
  const started = new Promise<void>((resolve) => {
    messagesStarted = resolve
  })

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_session_timeline_loading",
      worktree: directory,
      vcs: "git",
      name: "session-timeline-loading",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "session-timeline-loading",
        projectID: "proj_session_timeline_loading",
        directory,
        title: "Session Timeline Loading",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    beforeMessagesResponse: async () => {
      messagesStarted()
      await pendingMessages
    },
  })

  try {
    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await started
    const loading = page.locator('[data-component="session-timeline-loading"]')
    await expect(loading).toBeVisible()

    finishMessages()
    await expect(loading).toBeHidden()
  } finally {
    finishMessages()
  }
})
