import { base64Encode } from "@spinosa/kernel-core/util/encode"
import { expect, test } from "../utils/diagnostic-test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/DesktopLeave"
const sessionID = "ses_desktop_leave"

test("conversation back asks before stopping and returns to workspace home", async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: "expected-console-error", description: "/experimental/onboarding/active" })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_desktop_leave", worktree: directory, vcs: "git", name: "DesktopLeave",
      time: { created: 1700000000000, updated: 1700000000000 }, sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [{
      id: sessionID, slug: "desktop-leave", projectID: "proj_desktop_leave", directory,
      title: "Desktop leave", version: "dev", time: { created: 1700000000000, updated: 1700000000000 },
    }],
    sessionStatus: { [sessionID]: { type: "busy" } },
    pageMessages: () => ({ items: [] }),
  })

  const aborts: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    if (new URL(request.url()).pathname.endsWith(`/session/${sessionID}/abort`)) aborts.push(request.url())
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  const back = page.getByRole("button", { name: "Back to workspace home" })
  await expect(back).toBeVisible()
  await back.click()
  const dialog = page.locator('[data-component="dialog"]')
  await expect(dialog.getByText("Going home will stop the current task")).toBeVisible()
  await dialog.getByRole("button", { name: "NO", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
  expect(aborts).toHaveLength(0)

  await back.click()
  await dialog.getByRole("button", { name: "YES", exact: true }).click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expect(page.getByRole("textbox", { name: "Prompt" })).toBeVisible()
  expect(aborts).toHaveLength(1)
})

test("leaving a busy conversation pauses queued follow-ups before abort", async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: "expected-console-error", description: "/experimental/onboarding/active" })
  let active = true
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_desktop_leave", worktree: directory, vcs: "git", name: "DesktopLeave",
      time: { created: 1700000000000, updated: 1700000000000 }, sandboxes: [],
    },
    provider: {
      all: [{ id: "opencode", name: "OpenCode", models: { "test-model": { id: "test-model", name: "Test Model", limit: { context: 200_000 } } } }],
      connected: ["opencode"], default: { providerID: "opencode", modelID: "test-model" },
    },
    sessions: [{
      id: sessionID, slug: "desktop-leave", projectID: "proj_desktop_leave", directory,
      title: "Desktop leave", version: "dev", time: { created: 1700000000000, updated: 1700000000000 },
    }],
    sessionStatus: () => active ? { [sessionID]: { type: "busy" } } : {},
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true, followup: "queue" } }))
  })
  await page.route(`**/session/${sessionID}/abort`, async (route) => {
    active = false
    await route.fallback()
  })
  const prompts: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.includes("/prompt")) prompts.push(request.url())
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  const editor = page.getByRole("textbox", { name: "Prompt" })
  await expect(editor).toBeVisible()
  await editor.fill("Do this after the current task")
  await editor.press("Enter")
  const dock = page.locator('[data-component="session-followup-dock"]')
  await expect(dock).toContainText("Do this after the current task")
  const prompt = dock.getByText("Do this after the current task")
  await expect(prompt).toHaveClass(/line-clamp-2/)
  await expect(dock.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-describedby", /^followup-prompt-/)

  await page.getByRole("button", { name: "Back to workspace home" }).click()
  await page.locator('[data-component="dialog"]').getByRole("button", { name: "YES", exact: true }).click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expect(page.locator('[data-component="session-followup-dock"]')).toContainText("Do this after the current task")
  expect(prompts).toHaveLength(0)
})
