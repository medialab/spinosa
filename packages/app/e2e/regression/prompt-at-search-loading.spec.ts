import { expect, test } from "../utils/diagnostic-test"
import { base64Encode } from "@spinosa/kernel-core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

for (const newLayoutDesigns of [false, true]) {
  test(`shows file-search progress in the ${newLayoutDesigns ? "V2" : "legacy"} prompt`, async ({ page }) => {
    const directory = `C:/OpenCode/PromptAtSearchLoading${newLayoutDesigns ? "V2" : "Legacy"}`
    const sessionID = `ses_prompt_at_search_loading_${newLayoutDesigns ? "v2" : "legacy"}`
    let searchStarted!: () => void
    let finishSearch!: (files: string[]) => void
    const started = new Promise<void>((resolve) => {
      searchStarted = resolve
    })
    const pending = new Promise<string[]>((resolve) => {
      finishSearch = resolve
    })

    await mockOpenCodeServer(page, {
      directory,
      project: {
        id: `proj_prompt_at_search_loading_${newLayoutDesigns ? "v2" : "legacy"}`,
        worktree: directory,
        vcs: "git",
        name: "prompt-at-search-loading",
        time: { created: 1700000000000, updated: 1700000000000 },
        sandboxes: [],
      },
      provider: { all: [], connected: [], default: {} },
      sessions: [
        {
          id: sessionID,
          slug: "prompt-at-search-loading",
          projectID: `proj_prompt_at_search_loading_${newLayoutDesigns ? "v2" : "legacy"}`,
          directory,
          title: "Prompt @ search loading",
          version: "dev",
          time: { created: 1700000000000, updated: 1700000000000 },
        },
      ],
      pageMessages: () => ({ items: [] }),
      findFiles: ({ query }) => {
        if (query !== "spinosa-loader-probe") return []
        searchStarted()
        return pending
      },
    })
    await page.addInitScript((value) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: value } }))
    }, newLayoutDesigns)

    try {
      await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
      const composer = page.locator(newLayoutDesigns ? '[data-component="prompt-input-v2"]' : "form").filter({
        has: page.locator('[data-component="prompt-input"][contenteditable="true"]'),
      })
      const editor = composer.locator('[data-component="prompt-input"][contenteditable="true"]')
      await expectAppVisible(editor)
      await editor.fill("@spinosa-loader-probe")
      await started

      const loading = page.locator('[data-component="prompt-suggestions-loading"]')
      await expect(loading).toBeVisible()

      finishSearch(["src/spinosa-loader-probe.ts"])
      await expect(page.getByRole("button", { name: /spinosa-loader-probe\.ts/ })).toBeVisible()
      await expect(loading).toBeHidden()
    } finally {
      finishSearch([])
    }
  })
}
