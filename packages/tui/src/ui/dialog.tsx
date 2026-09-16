import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createContext, createEffect, onCleanup, Show, useContext, type JSX, type ParentProps } from "solid-js"
import { useTheme } from "../context/theme"
import { MouseButton, Renderable, RGBA } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useToast } from "./toast"
import { Flag } from "@spinosa/kernel-core/flag/flag"
import { useBindings, useOpencodeModeStack } from "../keymap"
import { useClipboard } from "../context/clipboard"
import { useExit } from "../context/exit"

export const DEFAULT_DIALOG_HEIGHT_RATIO = 0.6
export const MARKDOWN_VIEWER_HEIGHT_RATIO = 0.8

export function dialogMaxHeight(terminalHeight: number, ratio = DEFAULT_DIALOG_HEIGHT_RATIO): number {
  if (terminalHeight < 30) return Math.max(1, terminalHeight - 2)
  return Math.max(1, Math.floor(terminalHeight * ratio))
}

export function Dialog(
  props: ParentProps<{
    size?: "medium" | "large" | "xlarge"
    heightRatio?: number
    onClose: () => void
  }>,
) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()

  let dismiss = false
  let backdropPressed = false
  const width = () => {
    if (props.size === "xlarge") return 116
    if (props.size === "large") return 88
    return 60
  }
  const maxHeight = () => dialogMaxHeight(dimensions().height, props.heightRatio ?? DEFAULT_DIALOG_HEIGHT_RATIO)

  return (
    <box
      onMouseDown={() => {
        backdropPressed = true
        dismiss = !!renderer.getSelection()
      }}
      onMouseUp={() => {
        if (!backdropPressed) return
        backdropPressed = false
        if (dismiss) {
          dismiss = false
          return
        }
        props.onClose?.()
      }}
      width={dimensions().width}
      height={dimensions().height}
      alignItems="center"
      justifyContent="center"
      position="absolute"
      zIndex={3000}
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseDown={(e: { stopPropagation(): void }) => {
          backdropPressed = false
          e.stopPropagation()
        }}
        onMouseUp={() => {
          backdropPressed = false
          dismiss = false
        }}
        width={width()}
        maxWidth={dimensions().width - 2}
        maxHeight={maxHeight()}
        flexShrink={1}
        flexDirection="column"
        overflow="hidden"
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
      >
        {props.children}
      </box>
    </box>
  )
}

function init() {
  const [store, setStore] = createStore({
    stack: [] as {
      element: JSX.Element | (() => JSX.Element)
      onClose?: () => void
      onEscape?: () => void
    }[],
    size: "medium" as "medium" | "large" | "xlarge",
    heightRatio: DEFAULT_DIALOG_HEIGHT_RATIO,
  })

  const renderer = useRenderer()
  const modeStack = useOpencodeModeStack()
  const exit = useExit()

  createEffect(() => {
    if (store.stack.length === 0) return
    const popMode = modeStack.push("modal")
    onCleanup(popMode)
  })

  let focus: Renderable | null
  function refocus() {
    setTimeout(() => {
      if (!focus) return
      if (focus.isDestroyed) return
      function find(item: Renderable) {
        for (const child of item.getChildren()) {
          if (child === focus) return true
          if (find(child)) return true
        }
        return false
      }
      const found = find(renderer.root)
      if (!found) return
      focus.focus()
    }, 1)
  }

  useBindings(() => ({
    enabled: store.stack.length > 0 && !renderer.getSelection()?.getSelectedText(),
    bindings: [
      {
        key: "escape",
        desc: "Close dialog",
        group: "Dialog",
        cmd: () => {
          if (renderer.getSelection()) {
            renderer.clearSelection()
          }
          const current = store.stack.at(-1)
          if (current?.onEscape) {
            current.onEscape()
            refocus()
            return
          }
          current?.onClose?.()
          setStore("stack", store.stack.slice(0, -1))
          refocus()
        },
      },
      {
        key: "ctrl+c",
        desc: "Quit",
        group: "Dialog",
        cmd: () => {
          exit()
        },
      },
    ],
  }))

  return {
    clear() {
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      batch(() => {
        setStore("size", "medium")
        setStore("heightRatio", DEFAULT_DIALOG_HEIGHT_RATIO)
        setStore("stack", [])
      })
      refocus()
    },
    replace(input: JSX.Element | (() => JSX.Element), onClose?: () => void, onEscape?: () => void) {
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      setStore("size", "medium")
      setStore("heightRatio", DEFAULT_DIALOG_HEIGHT_RATIO)
      setStore("stack", [
        {
          element: input,
          onClose,
          onEscape,
        },
      ])
    },
    /** Close all dialogs without running stack onClose callbacks. */
    dismiss() {
      batch(() => {
        setStore("size", "medium")
        setStore("heightRatio", DEFAULT_DIALOG_HEIGHT_RATIO)
        setStore("stack", [])
      })
      refocus()
    },
    get stack() {
      return store.stack
    },
    get size() {
      return store.size
    },
    get heightRatio() {
      return store.heightRatio
    },
    setSize(size: "medium" | "large" | "xlarge") {
      setStore("size", size)
    },
    setHeightRatio(ratio: number) {
      setStore("heightRatio", ratio)
    },
  }
}

export type DialogContext = ReturnType<typeof init>

const ctx = createContext<DialogContext>()

export function DialogProvider(props: ParentProps) {
  const value = init()
  const renderer = useRenderer()
  const toast = useToast()
  const clipboard = useClipboard()

  function copySelection() {
    const text = renderer.getSelection()?.getSelectedText()
    if (!text || !clipboard.write) return false
    void clipboard.write(text).then(
      () => toast.show({ message: "Copied to clipboard", variant: "info" }),
      (error) => toast.error(error),
    )
    renderer.clearSelection()
    return true
  }

  return (
    <ctx.Provider value={value}>
      {props.children}
      <Show when={value.stack.length}>
        <box
          position="absolute"
          left={0}
          top={0}
          width="100%"
          height="100%"
          zIndex={3000}
          onMouseDown={(evt: { button: number; preventDefault(): void; stopPropagation(): void }) => {
            if (!Flag.SPINOSA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
            if (evt.button !== MouseButton.RIGHT) return

            if (!copySelection()) return
            evt.preventDefault()
            evt.stopPropagation()
          }}
          onMouseUp={!Flag.SPINOSA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT ? copySelection : undefined}
        >
          <Dialog onClose={() => value.clear()} size={value.size} heightRatio={value.heightRatio}>
            {(() => {
              const element = value.stack.at(-1)!.element
              return typeof element === "function" ? element() : element
            })()}
          </Dialog>
        </box>
      </Show>
    </ctx.Provider>
  )
}

export function useDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return value
}
