import { expect, test } from "../utils/diagnostic-test"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("preserves a collapsed context group through count and status updates", async ({ page }) => {
  const ids = ["prt_closed_01_read", "prt_closed_02_glob"]
  const inputs = {
    read: { filePath: "src/a.ts", offset: 0, limit: 120 },
    glob: { path: ".", pattern: "**/*.ts" },
  }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [toolPart(ids[0]!, "read", "running", inputs.read), toolPart(ids[1]!, "glob", "running", inputs.glob)],
        { completed: false },
      ),
    ],
  })
  const group = page.locator(`[data-timeline-part-ids="${ids.join(",")}"]`)
  const trigger = group.locator('[data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await timeline.send(partUpdated(toolPart(ids[0]!, "read", "completed", inputs.read)), 100)
  await timeline.send(partUpdated(toolPart(ids[1]!, "glob", "completed", inputs.glob)), 300)
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
})

test("shows copy buttons for grouped context tools", async ({ page }) => {
  const read = toolPart("prt_copy_01_read", "read", "completed", { filePath: "src/a.ts" })
  const glob = toolPart("prt_copy_02_glob", "glob", "completed", { path: "src", pattern: "**/*.ts" })
  await setupTimeline(page, { messages: [userMessage(), assistantMessage([read, glob])] })

  const group = page.locator('[data-timeline-part-ids="prt_copy_01_read,prt_copy_02_glob"]')
  await page.getByRole("button", { name: /Explored.*read.*search/ }).click()
  const bubbles = group.locator('[data-component="tool-bubble"]')
  await expect(bubbles).toHaveCount(2)
  await bubbles.first().click()
  await expect(bubbles.first()).toHaveAttribute("data-copied", "true")
})

test("keeps a standalone tool copy button clickable in the centered timeline", async ({ page }) => {
  const shell = toolPart("prt_copy_shell", "shell", "completed", { command: "pwd" })
  await setupTimeline(page, { messages: [userMessage(), assistantMessage([shell])] })

  const bubble = page.locator('[data-timeline-part-id="prt_copy_shell"] [data-component="tool-bubble"]')
  await expect(bubble).toBeVisible()
  await bubble.click()
  await expect(bubble).toHaveAttribute("data-copied", "true")
})
