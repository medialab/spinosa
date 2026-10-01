import { expect, test } from "../utils/diagnostic-test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

test("shows workspace discovery progress and retries a failed registry request", async ({ page }, testInfo) => {
  testInfo.annotations.push({
    type: "expected-console-error",
    description: "/global/spinosa/workspaces",
  })
  let finishRetry!: () => void
  let retryStarted!: () => void
  let retrying = false
  const pendingRetry = new Promise<void>((resolve) => {
    finishRetry = resolve
  })
  const retryRequested = new Promise<void>((resolve) => {
    retryStarted = resolve
  })

  await mockOpenCodeServer(page, {
    directory: "C:/OpenCode/WorkspaceDiscoveryLoading",
    project: {
      id: "proj_workspace_discovery_loading",
      worktree: "C:/OpenCode/WorkspaceDiscoveryLoading",
      vcs: "git",
      name: "workspace-discovery-loading",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [{ id: "opencode", name: "OpenCode", models: {} }],
      connected: ["opencode"],
      default: {},
    },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.endsWith("/global/spinosa/workspaces")) return route.fallback()
    if (!retrying) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "workspace registry unavailable" }),
      })
      return
    }
    retryStarted()
    await pendingRetry
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  })

  try {
    await page.goto("/")
    await expectAppVisible(page.getByRole("heading", { name: "Spinosa", exact: true }))
    const alert = page.getByRole("alert")
    await expect(alert).toContainText("workspace registry unavailable")
    retrying = true
    await page.getByRole("button", { name: "Continue", exact: true }).click()
    await retryRequested
    await expect(page.locator('[data-component="workspace-discovery-loading"]')).toBeVisible()
    finishRetry()

    await expect(page.locator('[data-component="workspace-discovery-loading"]')).toBeHidden()
    await expect(alert).toBeHidden()
  } finally {
    finishRetry()
  }
})
