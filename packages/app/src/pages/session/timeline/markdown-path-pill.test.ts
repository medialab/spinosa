import { expect, test } from "bun:test"
import { decorateMarkdownPathPills, installMarkdownPathPills } from "./markdown-path-pill"

test("turns markdown file paths in chat text into viewer links", () => {
  const root = document.createElement("div")
  root.innerHTML = `
    <div data-slot="session-turn-assistant-content">
      <div data-component="markdown">
        <p>Read docs/guide.md, then <code>notes/plan.md</code>.</p>
        <p><a href="./README.md">README</a> and <a href="file:///repo/guide.md">Guide</a> and <code>src/app.ts</code> and <code>My Notes.md</code> and <code>reports/*.md</code></p>
        <pre><code>docs/hidden.md</code></pre>
      </div>
    </div>
    <div data-slot="user-message-text">Check todo.md before lunch. <span data-highlight="file">@linked.md</span></div>
  `

  decorateMarkdownPathPills(root)
  decorateMarkdownPathPills(root)

  const pills = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-slot="markdown-path-pill"]'))
  expect(pills.map((pill) => [pill.textContent, pill.dataset.href])).toEqual([
    ["docs/guide.md", "docs/guide.md"],
    ["notes/plan.md", "notes/plan.md"],
    ["README", "./README.md"],
    ["Guide", "file:///repo/guide.md"],
    ["My Notes.md", "My Notes.md"],
    ["todo.md", "todo.md"],
  ])
  expect(pills.every((pill) => pill.classList.contains("bg-[#eaf3ff]") && pill.classList.contains("text-[#1764b4]"))).toBe(true)
  expect(root.querySelector("pre a")).toBeNull()
  expect(root.querySelector("[data-highlight] a")).toBeNull()
  expect(root.querySelector("code")?.textContent).toBe("src/app.ts")
  expect(root.querySelectorAll("code")[1]?.textContent).toBe("reports/*.md")
})

test("decorates newly rendered chat text without changing other links", async () => {
  const root = document.createElement("div")
  const stop = installMarkdownPathPills(root, () => true)
  root.innerHTML = `<div data-slot="session-turn-assistant-content"><div data-component="markdown"><p>See report.md.</p><a href="https://example.com/report.md">Remote</a><code>report.mdx</code><code>javascript:bad.md</code></div></div>`
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(root.querySelectorAll('[data-slot="markdown-path-pill"]')).toHaveLength(1)
  expect(root.querySelector('[data-slot="markdown-path-pill"]')?.textContent).toBe("report.md")
  expect(root.querySelector('a[href="https://example.com/report.md"]')?.getAttribute("data-slot")).toBeNull()
  expect(root.querySelector("code")?.textContent).toBe("report.mdx")
  expect(root.querySelectorAll("code")).toHaveLength(2)
  stop()
})

test("opens a pill through the in-app viewer callback without browser navigation", () => {
  const root = document.createElement("div")
  root.innerHTML = `<div data-slot="session-turn-assistant-content"><div data-component="markdown">Read docs/guide.md</div></div>`
  const opened: string[] = []
  const stop = installMarkdownPathPills(root, (href) => {
    opened.push(href)
    return true
  })
  const link = root.querySelector<HTMLButtonElement>('button[data-slot="markdown-path-pill"]')!
  const event = new MouseEvent("click", { bubbles: true, cancelable: true })
  link.dispatchEvent(event)
  expect(opened).toEqual(["docs/guide.md"])
  expect(event.defaultPrevented).toBe(true)
  stop()
})
