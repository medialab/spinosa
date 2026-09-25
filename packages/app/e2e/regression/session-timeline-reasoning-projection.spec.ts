import { expect, test } from "../utils/diagnostic-test"
import {
  assistantMessage,
  partUpdated,
  reasoningPart,
  setupTimeline,
  status,
  textPart,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

const profiles = [
  { name: "summaries off no reasoning", summaries: false, reasoning: "", other: false, thinking: true, body: false },
  {
    name: "summaries off reasoning heading",
    summaries: false,
    reasoning: "## Inspecting stability",
    other: false,
    thinking: true,
    body: false,
  },
  {
    name: "summaries off with visible tool",
    summaries: false,
    reasoning: "## Inspecting stability",
    other: true,
    thinking: true,
    body: false,
  },
  { name: "summaries on no content", summaries: true, reasoning: "", other: false, thinking: true, body: false },
  {
    name: "summaries on blank reasoning",
    summaries: true,
    reasoning: "   ",
    other: false,
    thinking: true,
    body: false,
  },
  {
    name: "summaries on visible reasoning",
    summaries: true,
    reasoning: "## Inspecting stability",
    other: false,
    thinking: false,
    body: true,
  },
  {
    name: "summaries on visible tool no reasoning",
    summaries: true,
    reasoning: "",
    other: true,
    thinking: false,
    body: false,
  },
] as const

for (const profile of profiles) {
  test(`projects busy reasoning profile ${profile.name}`, async ({ page }) => {
    const reasoningID = `prt_reasoning_matrix_${profiles.indexOf(profile)}`
    const parts = [
      ...(profile.reasoning ? [reasoningPart(reasoningID, profile.reasoning)] : []),
      ...(profile.other
        ? [toolPart(`prt_reasoning_tool_${profiles.indexOf(profile)}`, "skill", "running", { name: "inspect" })]
        : []),
    ]
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage(parts, { completed: false })],
      settings: { showReasoningSummaries: profile.summaries },
    })
    await timeline.send(status("busy"), 150)

    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(profile.thinking ? 1 : 0)
    await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(profile.body ? 1 : 0)
    if (!profile.summaries && profile.reasoning.trim()) {
      await expect(page.getByText("Inspecting stability", { exact: true })).toBeVisible()
    }
  })
}

test("keeps expanded thinking markdown stable while reasoning streams", async ({ page }) => {
  const reasoningID = "prt_reasoning_streaming_thinking"
  const initial = "## Planning\n\nThe first thought is stable."
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([reasoningPart(reasoningID, initial)], { completed: false })],
  })
  await timeline.send(status("busy"), 150)

  const row = page.locator('[data-timeline-row="Thinking"]')
  await row.locator('button[aria-expanded="false"]').click()
  const markdown = row.locator('[data-component="markdown"]')
  const heading = markdown.locator("h2")
  await expect(heading).toHaveText("Planning")
  const presentation = await markdown.evaluate((root) => {
    const content = root.parentElement!
    const panel = content.parentElement!
    return {
      fontSize: getComputedStyle(root).fontSize,
      headingFontSize: getComputedStyle(root.querySelector("h2")!).fontSize,
      opacity: getComputedStyle(content).opacity,
      paddingLeft: getComputedStyle(panel).paddingLeft,
      marginLeft: getComputedStyle(panel).marginLeft,
    }
  })
  expect(presentation).toEqual({
    fontSize: "11px",
    headingFontSize: "11px",
    opacity: "0.8",
    paddingLeft: "0px",
    marginLeft: "0px",
  })
  await markdown.evaluate((root) => {
    const heading = root.querySelector("h2")
    if (!heading) throw new Error("missing rendered thinking heading")
    const probe = { root, heading, replaced: false, observer: undefined as MutationObserver | undefined }
    const observer = new MutationObserver(() => {
      if (!root.contains(heading)) probe.replaced = true
    })
    probe.observer = observer
    observer.observe(root, { childList: true, subtree: true })
    ;(window as Window & { __thinkingMarkdownProbe?: typeof probe }).__thinkingMarkdownProbe = probe
  })

  const next = `${initial}\n\nThe next thought`
  await timeline.send(partUpdated(reasoningPart(reasoningID, next)), 100)
  await expect(markdown).toContainText("The next thought")
  await timeline.send(partUpdated(reasoningPart(reasoningID, `${next} explains the plan."`)), 100)
  await expect(markdown).toContainText("The next thought explains the plan.")

  const headingWasReplaced = await page.evaluate(() => {
    const probe = (window as Window & { __thinkingMarkdownProbe?: { root: Element; heading: Element; replaced: boolean; observer: MutationObserver } })
      .__thinkingMarkdownProbe
    probe?.observer.disconnect()
    return probe?.replaced ?? true
  })
  expect(headingWasReplaced).toBe(false)
})

test("does not infer reasoning visibility from provider identity", async ({ page }) => {
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([textPart("prt_provider_text", "No reasoning payload")], { completed: false }),
    ],
    settings: { showReasoningSummaries: true },
  })
  await timeline.send(status("busy"), 150)

  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-part-id*="reasoning"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-part-id="prt_provider_text"]')).toBeVisible()
})
