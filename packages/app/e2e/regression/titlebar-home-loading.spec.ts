import { expect, test } from "../utils/diagnostic-test"
import { base64Encode } from "@spinosa/kernel-core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

test("shows Home-check and task-stop progress, including recovery from a failed check", async ({ page }, testInfo) => {
  testInfo.annotations.push({
    type: "expected-console-error",
    description: "/experimental/onboarding/active",
  })
  const directory = "C:/OpenCode/TitlebarHomeLoading"
  const sessionID = "ses_titlebar_home_loading"
  let finishFirstCheck!: () => void
  let firstCheckStarted!: () => void
  let checks = 0
  let finishStop!: () => void
  let stopStarted!: () => void
  const firstCheck = new Promise<void>((resolve) => {
    finishFirstCheck = resolve
  })
  const started = new Promise<void>((resolve) => {
    firstCheckStarted = resolve
  })
  const pendingStop = new Promise<void>((resolve) => {
    finishStop = resolve
  })
  const stopping = new Promise<void>((resolve) => {
    stopStarted = resolve
  })

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_titlebar_home_loading",
      worktree: directory,
      vcs: "git",
      name: "titlebar-home-loading",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "titlebar-home-loading",
        projectID: "proj_titlebar_home_loading",
        directory,
        title: "Titlebar Home Loading",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/experimental/onboarding/jobs/job_titlebar_home_loading/cancel") {
      stopStarted()
      await pendingStop
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "job_titlebar_home_loading", status: "cancelled" }),
      })
      return
    }
    if (url.pathname === "/experimental/onboarding/active") {
      checks += 1
      if (checks === 1) {
        // The session's background-import status poll happens before Home is clicked.
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
        return
      }
      if (checks === 2) {
        firstCheckStarted()
        await firstCheck
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "onboarding service unavailable" }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "job_titlebar_home_loading", status: "running" }),
      })
      return
    }
    return route.fallback()
  })

  try {
    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectAppVisible(page.locator('[data-component="prompt-input"]'))
    await expect(page.locator("header").getByRole("button", { name: "New session", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Home", exact: true }).click()
    await started
    await expect(page.locator('[data-component="home-task-check-loading"]')).toBeVisible()

    finishFirstCheck()
    const dialog = page.locator('[data-component="dialog"]')
    await expect(dialog.getByRole("alert")).toContainText("onboarding service unavailable")
    await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))

    await dialog.getByRole("button", { name: "Continue", exact: true }).click()
    await expect(dialog.getByText("Going home will stop the current task")).toBeVisible()
    await dialog.getByRole("button", { name: "YES", exact: true }).click()
    await stopping
    await expect(dialog.locator('[data-component="home-task-stopping"]')).toBeVisible()
    finishStop()
    await expect(page).toHaveURL("/")
  } finally {
    finishFirstCheck()
    finishStop()
  }
})

test("returns home when no onboarding job is active", async ({ page }, testInfo) => {
  testInfo.annotations.push({
    type: "expected-console-error",
    description: "/experimental/onboarding/active",
  })
  const directory = "C:/OpenCode/TitlebarHomeWithoutActiveJob"
  const sessionID = "ses_titlebar_home_without_active_job"

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_titlebar_home_without_active_job",
      worktree: directory,
      vcs: "git",
      name: "titlebar-home-without-active-job",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "titlebar-home-without-active-job",
        projectID: "proj_titlebar_home_without_active_job",
        directory,
        title: "Titlebar Home Without Active Job",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    sessionStatus: { [sessionID]: { type: "idle" } },
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== "/experimental/onboarding/active") return route.fallback()
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ _tag: "NotFound" }),
    })
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.locator('[data-component="prompt-input"]'))
  await page.getByRole("button", { name: "Home", exact: true }).click()

  await expect(page).toHaveURL("/")
  await expectAppVisible(page.getByRole("heading", { name: "SPINOSA", exact: true }))
  await expect(page.locator('[data-component="dialog"]')).toHaveCount(0)
})
