import { expect, test } from "../utils/diagnostic-test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/NewSessionVisualizer"
const draftID = "draft_new_session_visualizer"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("workspace home switches to its full-size visualizer and back", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_new_session_visualizer", worktree: directory, vcs: "git", name: "NewSessionVisualizer",
      time: { created: 1700000000000, updated: 1700000000000 }, sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(({ directory, draftID, server }) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({
      projects: { local: [{ worktree: directory, expanded: true }] },
      lastProject: { local: directory },
    }))
    localStorage.setItem("opencode.window.browser.dat:tabs", JSON.stringify([
      { type: "draft", draftID, server, directory },
    ]))
  }, { directory, draftID, server })
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/file" || url.pathname === "/api/file") {
      const data = url.searchParams.get("path") === "raw" ? [{ path: "raw/note.md", type: "file" }] : []
      return route.fulfill({ json: data })
    }
    if (url.pathname === "/file/content" || url.pathname === "/api/file/content")
      return route.fulfill({ json: { type: "text", content: "# Note" } })
    return route.fallback()
  })

  await page.goto(`/new-session?draftId=${draftID}`)
  const prompt = page.getByRole("textbox", { name: "Prompt" })
  await expect(prompt).toBeVisible()
  await page.getByRole("button", { name: "Visualizer" }).click()
  const graph = page.getByTestId("session-workspace-visualizer")
  await expect(graph).toBeVisible()
  await expect(prompt).toBeHidden()
  const bounds = await graph.boundingBox()
  const main = await page.locator("main").boundingBox()
  expect(bounds).not.toBeNull()
  expect(main).not.toBeNull()
  expect(bounds!.width).toBeGreaterThan(page.viewportSize()!.width - 4)
  expect(bounds!.y + bounds!.height).toBeGreaterThan(main!.y + main!.height - 4)
  await page.getByRole("group", { name: "Conversation view" }).getByRole("button", { name: "Home" }).click()
  await expect(prompt).toBeVisible()
  await expect(graph).toHaveCount(0)
})
