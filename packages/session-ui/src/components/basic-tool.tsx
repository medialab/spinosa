import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type Accessor, type JSX } from "solid-js"
import { animate, type AnimationPlaybackControls } from "motion"
import { useI18n } from "@spinosa/ui/context/i18n"
import { createStore } from "solid-js/store"
import { Collapsible } from "@spinosa/ui/collapsible"
import type { IconProps } from "@spinosa/ui/icon"
import { TextShimmer } from "@spinosa/ui/text-shimmer"

export type TriggerTitle = {
  title: string
  titleClass?: string
  subtitle?: string
  subtitleClass?: string
  args?: string[]
  argsClass?: string
  action?: JSX.Element
}

const isTriggerTitle = (val: any): val is TriggerTitle => {
  return (
    typeof val === "object" && val !== null && "title" in val && (typeof Node === "undefined" || !(val instanceof Node))
  )
}

export interface BasicToolProps {
  icon: IconProps["name"]
  trigger: TriggerTitle | JSX.Element | ((open: Accessor<boolean>) => JSX.Element)
  children?: JSX.Element
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  forceOpen?: boolean
  allowOpenWhilePending?: boolean
  defer?: boolean
  locked?: boolean
  animated?: boolean
  onSubtitleClick?: () => void
  onTriggerClick?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>
  onTriggerKeyDown?: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent>
  triggerHref?: string
  triggerAsLink?: boolean
  clickable?: boolean
  tool?: string
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
  output?: string
}

const TOOL_BUBBLE_TAGS: Record<string, string> = {
  shell: "SHELL",
  bash: "SHELL",
  read: "READ",
  list: "LIST",
  glob: "GLOB",
  grep: "GREP",
  webfetch: "FETCH",
  websearch: "SEARCH",
  web: "WEB",
  edit: "EDIT",
  write: "WRITE",
  patch: "PATCH",
  apply_patch: "PATCH",
  todowrite: "TODO",
  question: "QUESTION",
  skill: "SKILL",
  task: "TASK",
}

export function toolBubbleTag(tool: string): string {
  const tag = TOOL_BUBBLE_TAGS[tool.toLowerCase()]
  if (tag) return tag
  const fallback = tool.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 12)
  return fallback || "TOOL"
}

export function toolDisplayName(tool: string): string {
  const normalized = tool.trim()
  if (!normalized) return normalized
  return normalized
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      if (index === 0) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join("")
}

function firstStringField(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) return undefined
  for (const key of keys) {
    const value = input[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

export function toolBubbleCopyText(
  tool: string,
  input?: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): string {
  const key = tool.toLowerCase()
  if (key === "shell" || key === "bash") {
    return firstStringField(input, ["command"]) ?? firstStringField(metadata, ["command"]) ?? ""
  }
  if (key === "read" || key === "edit" || key === "write" || key === "patch" || key === "apply_patch") {
    return firstStringField(input, ["filePath", "path"]) ?? ""
  }
  if (key === "list") {
    return firstStringField(input, ["path"]) ?? ""
  }
  if (key === "glob") {
    const pattern = firstStringField(input, ["pattern"]) ?? ""
    const dir = firstStringField(input, ["path"])
    return dir ? `${pattern} in ${dir}` : pattern
  }
  if (key === "grep") {
    const pattern = firstStringField(input, ["pattern"]) ?? ""
    const dir = firstStringField(input, ["path"])
    return dir ? `${pattern} in ${dir}` : pattern
  }
  if (key === "webfetch" || key === "web") {
    return firstStringField(input, ["url"]) ?? firstStringField(input, ["query"]) ?? ""
  }
  if (key === "websearch") {
    return firstStringField(input, ["query"]) ?? ""
  }
  if (key === "task") {
    return firstStringField(input, ["description"]) ?? ""
  }
  if (key === "skill") {
    return firstStringField(input, ["name"]) ?? ""
  }
  if (key === "question") {
    const questions = input?.["questions"]
    if (Array.isArray(questions)) {
      const first = questions.find(
        (item): item is { question?: unknown } => !!item && typeof item === "object" && "question" in item,
      )
      if (first && typeof first.question === "string") return first.question
    }
    return ""
  }
  return (
    firstStringField(input, ["command", "query", "url", "filePath", "path", "pattern", "name", "description"]) ?? ""
  )
}

async function copyBubbleText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall back to document copy when Clipboard API access is unavailable.
  }
  if (typeof document === "undefined" || !document.body) return false
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  try {
    textarea.select()
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

export function ToolBubble(props: { tag: string; copyText: string; failed?: boolean }) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
  const copy = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation()
    event.preventDefault()
    if (!props.copyText || copied()) return
    void copyBubbleText(props.copyText).then((ok) => {
      if (!ok) return
      setCopied(true)
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <span
      role="button"
      tabIndex={0}
      data-component="tool-bubble"
      data-copied={copied() ? "true" : undefined}
      data-failed={props.failed ? "true" : undefined}
      title={i18n.t("ui.toolBubble.copy")}
      aria-label={copied() ? i18n.t("ui.toolBubble.copied") : i18n.t("ui.toolBubble.copy")}
      onClick={copy}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        copy(event)
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <span data-slot="tool-bubble-tag">{props.tag}</span>
      <span data-slot="tool-bubble-copy">
        {copied() ? i18n.t("ui.toolBubble.copied") : i18n.t("ui.toolBubble.copy")}
      </span>
    </span>
  )
}

const SPRING = { type: "spring" as const, visualDuration: 0.35, bounce: 0 }
const deferredMounts: Array<{ active: boolean; fn: () => void }> = []
let deferredFrame: number | undefined

function flushDeferredMounts() {
  while (deferredMounts.length > 0) {
    // Timeline tools are mounted top-to-bottom, but the viewport starts at the latest turn.
    // Pop from the end so heavy default-open bodies near the bottom become interactive first.
    const item = deferredMounts.pop()!
    if (item.active) {
      deferredFrame = deferredMounts.length > 0 ? requestAnimationFrame(flushDeferredMounts) : undefined
      item.fn()
      return
    }
  }
  deferredFrame = undefined
}

function scheduleDeferredFlush() {
  if (deferredFrame !== undefined) return
  deferredFrame = requestAnimationFrame(() => {
    deferredFrame = requestAnimationFrame(flushDeferredMounts)
  })
}

function scheduleDeferredMount(fn: () => void) {
  const item = { active: true, fn }
  deferredMounts.push(item)
  scheduleDeferredFlush()
  return () => {
    item.active = false
  }
}

function scheduleFrameMount(fn: () => void) {
  const frame = requestAnimationFrame(fn)
  return () => cancelAnimationFrame(frame)
}

export function BasicTool(props: BasicToolProps) {
  const [state, setState] = createStore({
    open: props.defaultOpen ?? false,
    ready: !props.defer && (props.defaultOpen ?? false),
  })
  const open = () => props.open ?? state.open
  const ready = () => state.ready
  const pending = () => props.status === "pending" || props.status === "running"
  const hasChildren = () => (props.defer ? "children" in props : props.children)
  const dynamicTrigger = typeof props.trigger === "function" ? props.trigger(open) : undefined

  let cancelReady: (() => void) | undefined

  const cancel = () => {
    cancelReady?.()
    cancelReady = undefined
  }

  const scheduleReady = (initial = false) => {
    cancel()
    cancelReady = (initial ? scheduleDeferredMount : scheduleFrameMount)(() => {
      cancelReady = undefined
      if (!open()) return
      setState("ready", true)
    })
  }

  onCleanup(cancel)

  onMount(() => {
    if (props.defer && open()) scheduleReady(true)
  })

  const setOpen = (value: boolean) => {
    if (props.open === undefined) setState("open", value)
    props.onOpenChange?.(value)
  }

  createEffect(() => {
    if (!props.forceOpen) return
    if (open()) return
    setOpen(true)
  })

  createEffect(
    on(
      open,
      (value) => {
        if (!props.defer) return
        if (!value) {
          cancel()
          setState("ready", false)
          return
        }

        scheduleReady()
      },
      { defer: true },
    ),
  )

  // Animated height for collapsible open/close
  let contentRef: HTMLDivElement | undefined
  let heightAnim: AnimationPlaybackControls | undefined
  const initialOpen = open()

  createEffect(
    on(
      open,
      (isOpen) => {
        if (!props.animated || !contentRef) return
        heightAnim?.stop()
        if (isOpen) {
          contentRef.style.overflow = "hidden"
          heightAnim = animate(contentRef, { height: "auto" }, SPRING)
          void heightAnim.finished.then(() => {
            if (!contentRef || !open()) return
            contentRef.style.overflow = "visible"
            contentRef.style.height = "auto"
          })
        } else {
          contentRef.style.overflow = "hidden"
          heightAnim = animate(contentRef, { height: "0px" }, SPRING)
        }
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    heightAnim?.stop()
  })

  const handleOpenChange = (value: boolean) => {
    if (pending() && !props.allowOpenWhilePending) return
    if (props.locked && !value) return
    setOpen(value)
  }

  const bubble = createMemo(() => {
    if (!props.tool) return undefined
    const copyText = toolBubbleCopyText(props.tool, props.input, props.metadata) || props.tool
    return { tag: toolBubbleTag(props.tool), copyText }
  })

  const trigger = () => (
    <div
      data-component="tool-trigger"
      data-has-bubble={bubble() ? "" : undefined}
      data-clickable={props.clickable ? "true" : undefined}
      data-hide-details={props.hideDetails ? "true" : undefined}
    >
      <Show when={bubble()}>
        {(item) => <ToolBubble tag={item().tag} copyText={item().copyText} failed={props.status === "error"} />}
      </Show>
      <div data-slot="basic-tool-tool-trigger-content">
        <div data-slot="basic-tool-tool-info">
          <Switch>
            <Match when={dynamicTrigger !== undefined}>{dynamicTrigger}</Match>
            <Match when={isTriggerTitle(props.trigger) && props.trigger}>
              {(title) => (
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span
                      data-slot="basic-tool-tool-title"
                      classList={{
                        [title().titleClass ?? ""]: !!title().titleClass,
                      }}
                    >
                      <TextShimmer text={title().title} active={pending()} />
                    </span>
                    <Show when={!pending() || title().subtitle || title().args?.length}>
                      <Show when={title().subtitle}>
                        <span
                          data-slot="basic-tool-tool-subtitle"
                          classList={{
                            [title().subtitleClass ?? ""]: !!title().subtitleClass,
                            clickable: !!props.onSubtitleClick,
                          }}
                          onClick={(e) => {
                            if (props.onSubtitleClick) {
                              e.stopPropagation()
                              props.onSubtitleClick()
                            }
                          }}
                        >
                          {title().subtitle}
                        </span>
                      </Show>
                      <Show when={title().args?.length}>
                        <For each={title().args}>
                          {(arg) => (
                            <span
                              data-slot="basic-tool-tool-arg"
                              classList={{
                                [title().argsClass ?? ""]: !!title().argsClass,
                              }}
                            >
                              {arg}
                            </span>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                  <Show when={!pending() && title().action}>
                    <span data-slot="basic-tool-tool-action">{title().action}</span>
                  </Show>
                </div>
              )}
            </Match>
            <Match when={true}>{props.trigger as JSX.Element}</Match>
          </Switch>
        </div>
      </div>
      <Show when={hasChildren() && !props.hideDetails && !props.locked && (!pending() || props.allowOpenWhilePending)}>
        <Collapsible.Arrow />
      </Show>
    </div>
  )

  return (
    <Collapsible open={open()} onOpenChange={handleOpenChange} class="tool-collapsible">
      <Show
        when={props.triggerAsLink || props.triggerHref}
        fallback={
          <Collapsible.Trigger
            data-hide-details={props.hideDetails ? "true" : undefined}
            onClick={props.onTriggerClick}
          >
            {trigger()}
          </Collapsible.Trigger>
        }
      >
        <Collapsible.Trigger
          as="a"
          href={props.triggerHref}
          role={!props.triggerHref && props.clickable ? "button" : undefined}
          tabIndex={!props.triggerHref && props.clickable ? 0 : undefined}
          data-hide-details={props.hideDetails ? "true" : undefined}
          onClick={props.onTriggerClick}
          onKeyDown={props.onTriggerKeyDown}
        >
          {trigger()}
        </Collapsible.Trigger>
      </Show>
      <Show when={props.animated && hasChildren() && !props.hideDetails}>
        <div
          ref={contentRef}
          data-slot="collapsible-content"
          data-animated
          style={{
            height: initialOpen ? "auto" : "0px",
            overflow: initialOpen ? "visible" : "hidden",
          }}
        >
          <Show when={!props.defer || ready()}>{props.children}</Show>
        </div>
      </Show>
      <Show when={!props.animated && hasChildren() && !props.hideDetails}>
        <Collapsible.Content>
          <Show when={!props.defer || ready()}>{props.children}</Show>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  )
}

function label(input: Record<string, unknown> | undefined) {
  const keys = ["description", "query", "url", "filePath", "path", "pattern", "name"]
  return keys.map((key) => input?.[key]).find((value): value is string => typeof value === "string" && value.length > 0)
}

function args(input: Record<string, unknown> | undefined) {
  if (!input) return []
  const skip = new Set(["description", "query", "url", "filePath", "path", "pattern", "name"])
  return Object.entries(input)
    .filter(([key]) => !skip.has(key))
    .flatMap(([key, value]) => {
      if (typeof value === "string") return [`${key}=${value}`]
      if (typeof value === "number") return [`${key}=${value}`]
      if (typeof value === "boolean") return [`${key}=${value}`]
      return []
    })
    .slice(0, 3)
}

export function GenericTool(props: {
  tool: string
  status?: string
  hideDetails?: boolean
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
  output?: string
}) {
  return (
    <BasicTool
      icon="mcp"
      status={props.status}
      trigger={{
        title: toolDisplayName(props.tool),
        subtitle: label(props.input),
        args: args(props.input),
      }}
      hideDetails={props.hideDetails}
      tool={props.tool}
      input={props.input}
      metadata={props.metadata}
      output={props.output}
    />
  )
}
