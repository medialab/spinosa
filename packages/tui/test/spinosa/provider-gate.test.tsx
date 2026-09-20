/** @jsxImportSource @opentui/solid */
import { afterEach, expect, mock, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { DEFAULT_THEMES, resolveTheme, selectedForeground } from "../../src/theme"

afterEach(() => mock.restore())

test("global home actions require a connected provider", async () => {
  const theme = resolveTheme(DEFAULT_THEMES.opencode, "dark")
  const [connected, setConnected] = createSignal(false)

  mock.module("../../src/context/theme", () => ({ useTheme: () => ({ theme }), selectedForeground }))
  mock.module("../../src/component/use-connected", () => ({ useConnected: () => connected }))
  mock.module("../../src/ui/dialog", () => ({ useDialog: () => ({ replace() {} }) }))
  mock.module("../../src/ui/toast", () => ({ useToast: () => ({ show() {} }) }))
  mock.module("../../src/context/route", () => ({ useRoute: () => ({ navigate() {} }) }))
  mock.module("../../src/context/exit", () => ({ useExit: () => () => {} }))
  mock.module("../../src/context/epilogue", () => ({ useEpilogue: () => () => {} }))
  mock.module("../../src/context/spinosa-workspace", () => ({
    useSpinosaWorkspace: () => ({ activePath: undefined, genericMode: false, meta: undefined, showPicker() {} }),
  }))
  mock.module("../../src/context/wait", () => ({
    useWait: () => ({
      label: () => undefined,
      begin() {},
      end() {},
      withWait: async (_text: string, work: () => Promise<unknown>) => work(),
    }),
  }))
  mock.module("../../src/context/prompt", () => ({ usePromptRef: () => ({ current: undefined }) }))
  mock.module("../../src/keymap", () => ({
    useBindings() {},
    useKeymapSelector: () => () => [],
    formatKeyBindings: () => "",
    useCommandShortcut: () => "",
    useOpencodeModeStack: () => ({ push() {}, pop() {} }),
    SPINOSA_BASE_MODE: "normal",
  }))

  const { SpinosaPromptChips } = await import("../../src/routes/workspace/spinosa-prompt-chips")
  const app = await testRender(() => <SpinosaPromptChips />, { width: 60, height: 8 })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Select provider")
    expect(app.captureCharFrame()).not.toContain("New workspace")
    expect(app.captureCharFrame()).not.toContain("Pick a workspace")

    setConnected(true)
    await app.flush()
    expect(app.captureCharFrame()).toContain("New workspace")
    expect(app.captureCharFrame()).toContain("Pick a workspace")
  } finally {
    app.renderer.destroy()
  }
})
