import { expect, mock, test } from "bun:test"
import { render } from "solid-js/web"

const { transformSync } = require("@babel/core") as {
  transformSync: (source: string, options: object) => { code: string }
}

Bun.plugin({
  name: "solid-visualizer-test",
  setup(build) {
    build.onLoad({ filter: /(?:session-workspace-visualizer|spinner)\.tsx$/ }, async ({ path }) => ({
      contents: transformSync(await Bun.file(path).text(), {
        filename: path,
        babelrc: false,
        configFile: false,
        presets: ["babel-preset-solid", "@babel/preset-typescript"],
      }).code,
      loader: "js",
    }))
  },
})

test("shows a spinner while loading and a visible error when the graph request fails", async () => {
  let rejectList!: (reason: Error) => void
  const list = new Promise<never>((_resolve, reject) => {
    rejectList = reject
  })

  mock.module("@/context/sdk", () => ({
    useSDK: () => () => ({ client: { file: { list: () => list } } }),
  }))
  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string, params?: { message?: string }) =>
        key === "session.visualizer.failed" ? `Could not load the raw-file graph: ${params?.message}` : key,
    }),
  }))

  const { SessionWorkspaceVisualizer } = await import("../src/pages/session/session-workspace-visualizer")
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => SessionWorkspaceVisualizer({ workspacePath: () => "/workspace", onOpenFile: () => {} }), host)

  try {
    expect(host.querySelector('[data-component="spinner"]')).not.toBeNull()
    expect(host.textContent).toContain("common.loading")

    rejectList(new Error("list unavailable"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(host.querySelector('[data-component="spinner"]')).toBeNull()
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(host.textContent).toContain("Could not load the raw-file graph: list unavailable")
    expect(host.textContent).toContain("session.visualizer.retry")
  } finally {
    dispose()
    host.remove()
  }
})
