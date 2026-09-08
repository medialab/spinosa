import { expect, mock, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Fiber } from "effect"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { AppNodeBuilder } from "@spinosa/kernel-core/effect/app-node-builder"
import { Global } from "@spinosa/kernel-core/global"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"
import { createWorkspaceID, type SpinosaWorkspaceID } from "@spinosa/core/workspace/identity"

type SpinosaRoute = "workspace" | "global" | "onboarding" | "add-files" | "visualizer"
type TestRenderer = Awaited<ReturnType<typeof createTestRenderer>>

async function renderRouteFrame(
  route: SpinosaRoute,
  options: {
    home?: string
    initialRoute?: Record<string, unknown>
    useDefaultRoute?: boolean
    cwd?: string
    height?: number
    act?: (setup: TestRenderer) => Promise<void> | void
  } = {},
) {
  const setup = await createTestRenderer({ width: 100, height: options.height ?? 30, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const previousRoute = process.env.SPINOSA_ROUTE
  const previousFastBoot = process.env.SPINOSA_FAST_BOOT
  const previousHome = process.env.HOME
  const previousTestHome = process.env.SPINOSA_TEST_HOME
  const previousSpinosaHome = process.env.SPINOSA_HOME
  const previousCwd = process.cwd()
  if (options.useDefaultRoute) delete process.env.SPINOSA_ROUTE
  else process.env.SPINOSA_ROUTE = JSON.stringify(options.initialRoute ?? { type: route })
  process.env.SPINOSA_FAST_BOOT = "1"
  if (options.cwd) process.chdir(options.cwd)
  if (options.home) {
    process.env.HOME = options.home
    process.env.SPINOSA_TEST_HOME = options.home
    process.env.SPINOSA_HOME = path.join(options.home, ".spinosa")
  }

  const events = createEventSource()
  const provider = {
    id: "test",
    name: "Test Provider",
    models: {
      "test-model": {
        id: "test-model",
        name: "Test Model",
        cost: { input: 1, output: 1 },
      },
    },
  }
  const calls = createFetch((url) => {
    if (url.pathname === "/config/providers") return json({ providers: [provider], default: { test: "test-model" } })
    if (url.pathname === "/provider") return json({ all: [provider], default: { test: "test-model" }, connected: ["test"] })
  }, events)
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  try {
    const { run } = await import("../../src/app")
    const fiber = Effect.runFork(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          async start() {
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    await setup.renderOnce()
    await setup.renderOnce()
    await options.act?.(setup)
    const frame = setup.captureCharFrame()
    await Effect.runPromise(Fiber.interrupt(fiber).pipe(Effect.timeout("1 second"))).catch(() => undefined)
    setup.renderer.destroy()
    return frame
  } finally {
    if (previousRoute === undefined) delete process.env.SPINOSA_ROUTE
    else process.env.SPINOSA_ROUTE = previousRoute
    if (previousFastBoot === undefined) delete process.env.SPINOSA_FAST_BOOT
    else process.env.SPINOSA_FAST_BOOT = previousFastBoot
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousTestHome === undefined) delete process.env.SPINOSA_TEST_HOME
    else process.env.SPINOSA_TEST_HOME = previousTestHome
    if (previousSpinosaHome === undefined) delete process.env.SPINOSA_HOME
    else process.env.SPINOSA_HOME = previousSpinosaHome
    if (process.cwd() !== previousCwd) process.chdir(previousCwd)
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}

async function createRegisteredWorkspace(input: {
  root: string
  home: string
  projectName: string
  setupStatus: "importing" | "cli_started" | "workspace_started"
  sourceLocation?: string
}) {
  const workspacePath = path.join(input.root, `${input.projectName}-spinosa`)
  const workspaceID = createWorkspaceID()
  mkdirSync(path.join(workspacePath, ".spinosa"), { recursive: true })
  mkdirSync(path.join(workspacePath, "raw"), { recursive: true })
  mkdirSync(path.join(workspacePath, "maps"), { recursive: true })
  mkdirSync(path.join(workspacePath, "logs"), { recursive: true })
  mkdirSync(path.join(workspacePath, "agent_reports"), { recursive: true })
  mkdirSync(path.join(workspacePath, "system"), { recursive: true })
  await Bun.write(
    path.join(workspacePath, ".spinosa", "workspace"),
    [
      `workspace_id: ${workspaceID}`,
      `project_name: ${input.projectName}`,
      ...(input.sourceLocation ? [`source_location: ${input.sourceLocation}`] : []),
      `setup_status: ${input.setupStatus}`,
      "framework_version: 0.1.0",
    ].join("\n"),
  )
  await Bun.write(path.join(workspacePath, "startup-prompt.md"), `Run startup for ${input.projectName}.`)

  const metadataDir = path.join(input.home, ".spinosa", "metadata")
  mkdirSync(metadataDir, { recursive: true })
  await appendRegistryEntry(input.home, workspacePath, input.projectName, workspaceID, input.setupStatus)
  return workspacePath
}

async function appendRegistryEntry(
  home: string,
  workspacePath: string,
  projectName: string,
  workspaceID?: SpinosaWorkspaceID,
  setupStatus: "importing" | "cli_started" | "workspace_started" | "unknown" = "unknown",
) {
  const metadataDir = path.join(home, ".spinosa", "metadata")
  mkdirSync(metadataDir, { recursive: true })
  const registryPath = path.join(metadataDir, "workspaces.json")
  const document = await Bun.file(registryPath).json().catch(() => ({ schemaVersion: 1, workspaces: [] as unknown[] }))
  document.workspaces.push({
    ...(workspaceID ? { id: workspaceID } : {}),
    path: workspacePath,
    name: projectName,
    tags: [],
    state: { presence: existsSync(workspacePath) ? "present" : "non_existent", setupStatus },
    registration: { registeredAt: "2026-07-09" },
  })
  await Bun.write(registryPath, `${JSON.stringify(document, null, 2)}\n`)
}

const maxWaitAttempts = process.env.CI ? 150 : 60

async function waitForText(setup: TestRenderer, text: string) {
  let frame = ""
  for (let attempt = 0; attempt < maxWaitAttempts; attempt++) {
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    if (frame.includes(text)) return frame
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error(`Timed out waiting for "${text}"\nlastFrame:\n${frame}`)
}

async function waitForAllText(setup: TestRenderer, texts: string[]) {
  let frame = ""
  for (let attempt = 0; attempt < maxWaitAttempts; attempt++) {
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    if (texts.every((text) => frame.includes(text))) return frame
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error(`Timed out waiting for ${texts.join(", ")}\nlastFrame:\n${frame}`)
}

async function waitForTextToDisappear(setup: TestRenderer, text: string) {
  let frame = ""
  for (let attempt = 0; attempt < maxWaitAttempts; attempt++) {
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    if (!frame.includes(text)) return frame
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error(`Timed out waiting for "${text}" to disappear\nlastFrame:\n${frame}`)
}

async function waitForWorkspacePickerReady(setup: TestRenderer, workspaceName?: string) {
  await waitForText(setup, "Choose a workspace")
  if (workspaceName) {
    await waitForText(setup, workspaceName)
  }
  return await waitForTextToDisappear(setup, "Loading saved workspaces…")
}

test("Spinosa app route E2E boots and navigates key workspace flows", async () => {
  const frame = await renderRouteFrame("global")
  expect(frame).toContain("Spinosa")
  expect(frame).toContain("New workspace")
  expect(frame).toContain("Pick a workspace")

  const onboardingFrame = await renderRouteFrame("onboarding")
  expect(onboardingFrame).toContain("Create Spinosa workspace")
  expect(onboardingFrame).toContain("Paste the corpus folder path")

  const addFilesFrame = await renderRouteFrame("add-files")
  expect(addFilesFrame).toContain("Import files into workspace")
  expect(addFilesFrame).toContain("Source folders")
  expect(addFilesFrame).toContain("Folder path 1")

  const cliRoot = mkdtempSync(path.join(tmpdir(), "spinosa-app-e2e-"))
  const cliHome = path.join(cliRoot, "home")
  mkdirSync(cliHome, { recursive: true })
  try {
    await createRegisteredWorkspace({
      root: cliRoot,
      home: cliHome,
      projectName: "cli-started-demo",
      setupStatus: "cli_started",
    })

    let startupChoiceFrame = ""
    const cliStartedFrame = await renderRouteFrame("global", {
        home: cliHome,
        act: async (setup) => {
          setup.mockInput.pressKey("w")
          await waitForWorkspacePickerReady(setup, "cli-started-demo")
        await waitForText(setup, "cli-started-demo")
        setup.mockInput.pressEnter()
        startupChoiceFrame = await waitForAllText(setup, [
          "Startup the workspace with prompt",
          "cli-started-demo",
        ])
        const startupLines = startupChoiceFrame.split("\n")
        const startupTitleY = startupLines.findIndex((line) => line.includes("cli-started-demo"))
        const escapeX = startupLines[startupTitleY]!.lastIndexOf("esc") + 1
        await setup.mockMouse.moveTo(escapeX, startupTitleY)
        await setup.mockMouse.click(escapeX, startupTitleY)
        await waitForWorkspacePickerReady(setup, "cli-started-demo")
      },
    })

    expect(startupChoiceFrame).toContain("cli-started-demo")
    expect(startupChoiceFrame).toContain("Startup the workspace with prompt")
    expect(cliStartedFrame).toContain("Choose a workspace")
    expect(cliStartedFrame).toContain("cli-started-demo")
  } finally {
    rmSync(cliRoot, { recursive: true, force: true })
  }

  const readyRoot = mkdtempSync(path.join(tmpdir(), "spinosa-app-e2e-"))
  const readyHome = path.join(readyRoot, "home")
  mkdirSync(readyHome, { recursive: true })
  try {
    await createRegisteredWorkspace({
      root: readyRoot,
      home: readyHome,
      projectName: "ready-demo",
      setupStatus: "workspace_started",
    })

    const readyFrame = await renderRouteFrame("global", {
        home: readyHome,
        act: async (setup) => {
          setup.mockInput.pressKey("w")
          await waitForWorkspacePickerReady(setup, "ready-demo")
        await waitForText(setup, "ready-demo")
        setup.mockInput.pressEnter()
        await waitForText(setup, "workspace v0.1.0")
      },
    })

    expect(readyFrame).toContain("workspace v0.1.0")
    expect(readyFrame).toContain("Switch workspace")
    expect(readyFrame).not.toContain("Visualizer")
    expect(readyFrame).not.toContain("Open setup brief in Chat")
  } finally {
    rmSync(readyRoot, { recursive: true, force: true })
  }

  const filteredRoot = mkdtempSync(path.join(tmpdir(), "spinosa-app-e2e-"))
  const filteredHome = path.join(filteredRoot, "home")
  mkdirSync(filteredHome, { recursive: true })
  try {
    await createRegisteredWorkspace({
      root: filteredRoot,
      home: filteredHome,
      projectName: "visible-demo",
      setupStatus: "workspace_started",
    })
    await appendRegistryEntry(
      filteredHome,
      path.join(filteredRoot, "stale-demo-spinosa"),
      "stale-demo",
      createWorkspaceID(),
    )

    let recentFrame = ""
    let pickerFrame = ""
    let missingDialogFrame = ""
    let refreshedPickerFrame = ""
    const filteredFrame = await renderRouteFrame("global", {
        home: filteredHome,
        act: async (setup) => {
          recentFrame = await waitForAllText(setup, ["Recent workspaces", "visible-demo", "stale-demo"])
          setup.mockInput.pressKey("w")
        pickerFrame = await waitForWorkspacePickerReady(setup, "stale-demo")
        setup.mockInput.pressKey("ARROW_UP")
        setup.mockInput.pressEnter()
        missingDialogFrame = await waitForText(setup, "Workspace not found")
        setup.mockInput.pressTab()
        setup.mockInput.pressTab()
        setup.mockInput.pressEnter()
        await waitForText(setup, "Confirm remove")
        setup.mockInput.pressEnter()
        refreshedPickerFrame = await waitForWorkspacePickerReady(setup, "visible-demo")
      },
    })

    expect(recentFrame).toContain("visible-demo")
    expect(recentFrame).toContain("stale-demo")
    expect(recentFrame).toContain("Not found")
    expect(pickerFrame).toContain("✕ stale-demo")
    expect(pickerFrame).toContain("✕ NOT FOUND")
    expect(missingDialogFrame).toContain("stale-demo")
    expect(missingDialogFrame).toContain("Workspace not found")
    expect(missingDialogFrame).toContain("Use new path")
    expect(missingDialogFrame).toContain("Scan computer")
    expect(missingDialogFrame).toContain("Remove from index")
    expect(refreshedPickerFrame).toContain("Choose a workspace")
    expect(refreshedPickerFrame).toContain("visible-demo")
    expect(refreshedPickerFrame).not.toContain("stale-demo")
    expect(filteredFrame).toContain("visible-demo")
    expect(filteredFrame).not.toContain("stale-demo")
    expect(await Bun.file(path.join(filteredHome, ".spinosa", "metadata", "workspaces.json")).text()).not.toContain("stale-demo")
  } finally {
    rmSync(filteredRoot, { recursive: true, force: true })
  }
}, 30_000)

test("boot cleanup removes stale installer files before the homepage renders", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-home-maintenance-"))
  const home = path.join(root, "home")
  const stale = path.join(home, ".spinosa", "versions", ".0.9.0.staging.999999")
  mkdirSync(path.join(stale, "node_modules"), { recursive: true })
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
  utimesSync(stale, old, old)
  try {
    const frame = await renderRouteFrame("workspace", {
      home,
      height: 50,
      act: async (setup) => {
        for (let attempt = 0; attempt < 30 && existsSync(stale); attempt++) {
          await setup.renderOnce()
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
      },
    })
    expect(frame).not.toContain("leftover install file")
    expect(existsSync(stale)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("a Recent workspace that disappears before click opens recovery instead of onboarding", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-recent-missing-"))
  const home = path.join(root, "home")
  mkdirSync(home, { recursive: true })
  try {
    const workspace = await createRegisteredWorkspace({
      root,
      home,
      projectName: "disappearing-demo",
      setupStatus: "workspace_started",
    })
    const frame = await renderRouteFrame("global", {
      home,
      act: async (setup) => {
        const recentFrame = await waitForText(setup, "disappearing-demo")
        rmSync(workspace, { recursive: true, force: true })
        const lines = recentFrame.split("\n")
        const y = lines.findIndex((line) => line.includes("disappearing-demo"))
        const x = lines[y]!.indexOf("disappearing-demo") + 1
        await setup.mockMouse.moveTo(x, y)
        await setup.mockMouse.click(x, y)
        await waitForText(setup, "Workspace not found")
      },
    })

    expect(frame).toContain("Workspace not found")
    expect(frame).toContain("Use new path")
    expect(frame).toContain("Scan computer")
    expect(frame).toContain("Remove from index")
    expect(frame).not.toContain("Create your research workspace")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("a present incomplete Recent workspace resumes at Step 2 and bottom Back returns to global home", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-recent-importing-"))
  const home = path.join(root, "home")
  const source = path.join(root, "importing-source")
  mkdirSync(home, { recursive: true })
  mkdirSync(source, { recursive: true })
  await Bun.write(path.join(source, "paper.md"), "partial import\n")
  try {
    await createRegisteredWorkspace({
      root,
      home,
      projectName: "importing-demo",
      setupStatus: "importing",
      sourceLocation: source,
    })
    const frame = await renderRouteFrame("global", {
      home,
      act: async (setup) => {
        const recentFrame = await waitForText(setup, "importing-demo")
        expect(recentFrame).toContain("Import incomplete")
        const lines = recentFrame.split("\n")
        const y = lines.findIndex((line) => line.includes("importing-demo"))
        const x = lines[y]!.indexOf("importing-demo") + 1
        await setup.mockMouse.moveTo(x, y)
        await setup.mockMouse.click(x, y)
        await waitForText(setup, "Resume Spinosa workspace")
        const resumedFrame = await waitForText(setup, "Workspace name")
        expect(resumedFrame).not.toContain("Source folders")
        const resumedLines = resumedFrame.split("\n")
        const backY = resumedLines.findIndex((line) => line.includes("Back"))
        const backX = resumedLines[backY]!.indexOf("Back") + 1
        await setup.mockMouse.moveTo(backX, backY)
        await setup.mockMouse.click(backX, backY)
        await waitForText(setup, "Recent workspaces")
        await waitForText(setup, "New workspace")
      },
    })

    expect(frame).toContain("Recent workspaces")
    expect(frame).toContain("New workspace")
    expect(frame).toContain("Pick a workspace")
    expect(frame).not.toContain("Switch workspace")
    expect(frame).not.toContain("Workspace not found")
    expect(frame).not.toContain("Show all")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("New workspace after leaving resumed onboarding starts fresh create flow", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-new-after-resume-"))
  const home = path.join(root, "home")
  const source = path.join(root, "importing-source")
  mkdirSync(home, { recursive: true })
  mkdirSync(source, { recursive: true })
  await Bun.write(path.join(source, "paper.md"), "partial import\n")
  try {
    await createRegisteredWorkspace({
      root,
      home,
      projectName: "dbg",
      setupStatus: "importing",
      sourceLocation: source,
    })
    const frame = await renderRouteFrame("global", {
      home,
      act: async (setup) => {
        const recentFrame = await waitForText(setup, "dbg")
        expect(recentFrame).toContain("Import incomplete")
        const recentLines = recentFrame.split("\n")
        const recentY = recentLines.findIndex((line) => line.includes("dbg"))
        const recentX = recentLines[recentY]!.indexOf("dbg") + 1
        await setup.mockMouse.moveTo(recentX, recentY)
        await setup.mockMouse.click(recentX, recentY)
        await waitForText(setup, "Resume Spinosa workspace")

        const resumedFrame = await waitForText(setup, "Workspace name")
        const resumedLines = resumedFrame.split("\n")
        const backY = resumedLines.findIndex((line) => line.includes("Back"))
        const backX = resumedLines[backY]!.indexOf("Back") + 1
        await setup.mockMouse.moveTo(backX, backY)
        await setup.mockMouse.click(backX, backY)
        await waitForText(setup, "Recent workspaces")

        const homeFrame = await waitForText(setup, "New workspace")
        const homeLines = homeFrame.split("\n")
        const newY = homeLines.findIndex((line) => line.includes("New workspace"))
        const newX = homeLines[newY]!.indexOf("New workspace") + 1
        await setup.mockMouse.moveTo(newX, newY)
        await setup.mockMouse.click(newX, newY)
        await waitForText(setup, "Create Spinosa workspace")
        await waitForText(setup, "Source folders")
      },
    })

    expect(frame).toContain("Create Spinosa workspace")
    expect(frame).toContain("Source folders")
    expect(frame).not.toContain("Resume Spinosa workspace")
    expect(frame).not.toContain("Workspace name")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("the top arrow exits resumed onboarding to global home", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-resume-arrow-back-"))
  const home = path.join(root, "home")
  const source = path.join(root, "importing-source")
  mkdirSync(home, { recursive: true })
  mkdirSync(source, { recursive: true })
  await Bun.write(path.join(source, "paper.md"), "partial import\n")
  try {
    await createRegisteredWorkspace({
      root,
      home,
      projectName: "arrow-back-demo",
      setupStatus: "importing",
      sourceLocation: source,
    })
    const frame = await renderRouteFrame("global", {
      home,
      act: async (setup) => {
        const recentFrame = await waitForText(setup, "arrow-back-demo")
        const recentLines = recentFrame.split("\n")
        const recentY = recentLines.findIndex((line) => line.includes("arrow-back-demo"))
        const recentX = recentLines[recentY]!.indexOf("arrow-back-demo") + 1
        await setup.mockMouse.moveTo(recentX, recentY)
        await setup.mockMouse.click(recentX, recentY)

        const resumedFrame = await waitForText(setup, "Workspace name")
        const resumedLines = resumedFrame.split("\n")
        const titleY = resumedLines.findIndex((line) => line.includes("Resume Spinosa workspace"))
        const arrowX = resumedLines[titleY]!.indexOf("←")
        await setup.mockMouse.moveTo(arrowX, titleY)
        await setup.mockMouse.click(arrowX, titleY)
        await waitForText(setup, "Recent workspaces")
      },
    })

    expect(frame).toContain("Recent workspaces")
    expect(frame).toContain("New workspace")
    expect(frame).toContain("Pick a workspace")
    expect(frame).not.toContain("Switch workspace")
    expect(frame).not.toContain("Import files")
    expect(frame).not.toContain("Visualizer")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("an incomplete workspace with an invalid saved source resumes at Step 1", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-resume-invalid-source-"))
  const home = path.join(root, "home")
  const missingSource = path.join(root, "missing-source")
  mkdirSync(home, { recursive: true })
  try {
    await createRegisteredWorkspace({
      root,
      home,
      projectName: "invalid-source-demo",
      setupStatus: "importing",
      sourceLocation: missingSource,
    })
    const frame = await renderRouteFrame("global", {
      home,
      act: async (setup) => {
        const recentFrame = await waitForText(setup, "invalid-source-demo")
        const lines = recentFrame.split("\n")
        const y = lines.findIndex((line) => line.includes("invalid-source-demo"))
        const x = lines[y]!.indexOf("invalid-source-demo") + 1
        await setup.mockMouse.moveTo(x, y)
        await setup.mockMouse.click(x, y)
        await waitForText(setup, "Resume Spinosa workspace")
        await waitForText(setup, "Source folders")
      },
    })

    expect(frame).toContain("Source folders")
    expect(frame).toContain(path.basename(missingSource))
    expect(frame).not.toContain("Workspace name")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("launching from an incomplete workspace resumes onboarding without an injected route", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-cwd-importing-"))
  const home = path.join(root, "home")
  const source = path.join(root, "source")
  mkdirSync(home, { recursive: true })
  mkdirSync(source, { recursive: true })
  await Bun.write(path.join(source, "paper.md"), "resume me\n")
  try {
    const workspace = await createRegisteredWorkspace({
      root,
      home,
      projectName: "cwd-importing-demo",
      setupStatus: "importing",
      sourceLocation: source,
    })
    const frame = await renderRouteFrame("global", {
      home,
      cwd: workspace,
      useDefaultRoute: true,
      act: async (setup) => { await waitForText(setup, "Workspace name") },
    })

    expect(frame).toContain("Resume Spinosa workspace")
    expect(frame).toContain("Workspace name")
    expect(frame).not.toContain("Source folders")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("fresh onboarding Back still returns to global home", async () => {
  const frame = await renderRouteFrame("onboarding", {
    act: async (setup) => {
      const onboardingFrame = await waitForText(setup, "Source folders")
      const lines = onboardingFrame.split("\n")
      const backY = lines.findIndex((line) => line.includes("Back"))
      const backX = lines[backY]!.indexOf("Back") + 1
      await setup.mockMouse.moveTo(backX, backY)
      await setup.mockMouse.click(backX, backY)
      await waitForText(setup, "New workspace")
    },
  })

  expect(frame).toContain("New workspace")
  expect(frame).not.toContain("Create Spinosa workspace")
})

test("Visualizer honors its workspace and session route parameters", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "spinosa-visualizer-route-"))
  const home = path.join(root, "home")
  mkdirSync(home, { recursive: true })
  try {
    const workspacePath = await createRegisteredWorkspace({
      root,
      home,
      projectName: "routed-demo",
      setupStatus: "workspace_started",
    })
    const frame = await renderRouteFrame("visualizer", {
      home,
      height: 50,
      initialRoute: { type: "visualizer", workspacePath, sessionID: "ses_routed" },
      act: async (setup) => { await waitForText(setup, "Workspace: routed-demo") },
    })
    expect(frame).toContain("Workspace: routed-demo")
    expect(frame).toContain("Session: ses_routed")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
