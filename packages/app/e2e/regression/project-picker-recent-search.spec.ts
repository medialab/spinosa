import { expect, test, type Page } from "../utils/diagnostic-test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

async function openHome(page: Page) {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    registeredWorkspaces: [],
    pageMessages,
  })

  const registry = page.waitForResponse((response) => new URL(response.url()).pathname === "/global/spinosa/workspaces")
  await page.goto("/")
  await expectAppVisible(page.getByRole("heading", { name: "Spinosa" }))
  const response = await registry
  expect(response.ok()).toBe(true)
  expect(await response.json()).toEqual([])
}

test("loads the Spinosa home and its registered-workspace catalog", async ({ page }) => {
  await openHome(page)
  await expect(page.getByRole("button", { name: "Connect provider" })).toBeVisible()
})
