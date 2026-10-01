import { expect, test } from "../utils/diagnostic-test"
import { setupTimeline } from "../performance/timeline-stability/fixture"

test("graph fills the session pane below the top bar", async ({ page }) => {
  await setupTimeline(page, { viewport: { width: 1400, height: 900 } })
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/file" || url.pathname === "/api/file") {
      const data = url.searchParams.get("path") === "raw" ? [
        { path: "raw/a.md", type: "file" },
        { path: "raw/b.md", type: "file" },
      ] : []
      return route.fulfill({ json: data })
    }
    if (url.pathname === "/file/content" || url.pathname === "/api/file/content")
      return route.fulfill({ json: { type: "text", content: "# Note" } })
    return route.fallback()
  })

  await page.getByRole("button", { name: "Visualizer" }).click()
  const visualizer = page.getByTestId("session-workspace-visualizer")
  const canvas = visualizer.locator("svg")
  await expect(canvas).toBeVisible()
  await expect(visualizer).toContainText("grouped by folder")
  const bounds = await canvas.boundingBox()
  const pane = await visualizer.boundingBox()
  expect(bounds).not.toBeNull()
  expect(pane).not.toBeNull()
  expect(bounds!.x).toBeLessThanOrEqual(2)
  expect(bounds!.width).toBeGreaterThanOrEqual(1396)
  expect(bounds!.y).toBeGreaterThanOrEqual(48)
  expect(bounds!.height).toBeGreaterThanOrEqual(800)
  expect(bounds!.y + bounds!.height).toBeCloseTo(pane!.y + pane!.height, 0)
})
