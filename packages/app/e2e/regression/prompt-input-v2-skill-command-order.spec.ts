import { expect, test, type Page } from "../utils/diagnostic-test"
import { base64Encode } from "@spinosa/kernel-core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/PromptSkillCommandOrder"
const projectID = "proj_prompt_skill_command_order"
const sessionID = "ses_prompt_skill_command_order"

for (const command of [
  { trigger: "find", builtinID: "dialog.find", heading: "Find in project" },
  { trigger: "skills", builtinID: "dialog.skills" },
  { trigger: "view", builtinID: "dialog.md.view" },
]) {
  test(`keeps /${command.trigger} above a colliding skill file`, async ({ page }) => {
    await setup(page)
    const composer = page.locator('[data-component="prompt-input-v2"]')
    const input = composer.locator('[data-component="prompt-input"]')
    await expectAppVisible(composer)
    await input.fill(`/${command.trigger}`)

    const builtin = page.locator(`[data-suggestion-id="${command.builtinID}"]`)
    const skill = page.locator(`[data-suggestion-id="custom.${command.trigger}"]`)
    await expect(builtin).toBeVisible()
    await expect(skill).toBeVisible()
    await expect(page.locator('[data-suggestion-section="commands"]')).toBeVisible()
    await expect(page.locator('[data-suggestion-section="skills"]')).toBeVisible()
    const ids = await page.locator("[data-suggestion-id]").evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-suggestion-id")),
    )
    expect(ids.indexOf(command.builtinID)).toBeLessThan(ids.indexOf(`custom.${command.trigger}`))

    await input.press("Enter")
    await expect(page.getByRole("dialog")).toBeVisible()
    if (command.heading) {
      await expect(page.getByRole("dialog").getByRole("heading", { name: command.heading })).toBeVisible()
    }
  })
}

async function setup(page: Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "prompt-skill-command-order",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "prompt-skill-command-order",
        projectID,
        directory,
        title: "Prompt skill command order",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.route(
    (url) => url.pathname === "/command" && url.port === (process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([
          { name: "find", template: "Find in the corpus", source: "skill" },
          { name: "skills", template: "Browse Spinosa skills", source: "skill" },
          { name: "view", template: "View a document", source: "skill" },
        ]),
      }),
  )
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
}
