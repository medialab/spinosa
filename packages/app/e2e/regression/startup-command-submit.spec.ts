import { base64Encode } from "@spinosa/kernel-core/util/encode"
import { expect, test } from "../utils/diagnostic-test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/StartupCommand"
const sessionID = "ses_startup_command"
const brief = "Map the workspace and prepare a setup brief."

for (const selection of ["Enter", "click"] as const) {
  test(`/startup submits the brief when selected by ${selection}`, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "expected-console-error", description: "/experimental/onboarding/active" })
    await mockOpenCodeServer(page, {
      directory,
      project: {
        id: "proj_startup_command", worktree: directory, vcs: "git", name: "StartupCommand",
        time: { created: 1700000000000, updated: 1700000000000 }, sandboxes: [],
      },
      provider: {
        all: [{ id: "opencode", name: "OpenCode", models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } } }],
        connected: ["opencode"], default: { providerID: "opencode", modelID: "test" },
      },
      sessions: [{
        id: sessionID, slug: sessionID, projectID: "proj_startup_command", directory,
        title: "Startup command", version: "dev", time: { created: 1700000000000, updated: 1700000000000 },
      }],
      pageMessages: () => ({ items: [] }),
    })
    await page.route("**/experimental/spinosa/workspace/startup-prompt?*", (route) =>
      route.fulfill({
        json: { input: brief, parts: [], autoSubmit: false, forceAgent: "build" },
        headers: { "access-control-allow-origin": "*" },
      }),
    )

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    const editor = page.locator('[data-component="prompt-input"][contenteditable="true"]')
    await expect(editor).toBeVisible()
    await editor.fill("/startup")
    const option = page.getByRole("button", { name: /\/startup\s+COMMAND/ })
    await expect(option).toBeVisible()
    const sent = page.waitForRequest((request) =>
      request.method() === "POST" && new URL(request.url()).pathname.includes(`/session/${sessionID}/prompt`),
    )
    if (selection === "Enter") await editor.press("Enter")
    else await option.click()
    const request = await sent
    expect(request.postData()).toContain(brief)
  })
}
