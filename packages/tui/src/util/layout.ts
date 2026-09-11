import type { BaseRenderable, BoxRenderable } from "@opentui/core"

const previousByParent = new WeakMap<
  BaseRenderable,
  { frameID: number; previous: WeakMap<BaseRenderable, BaseRenderable | undefined> }
>()

export function setPreLayoutSiblingMargin(el: BoxRenderable, margin: (previous?: BaseRenderable) => number) {
  // Run before Yoga layout so scroll geometry matches the rendered frame.
  el.onLifecyclePass = () => {
    const parent = el.parent
    if (!parent) return
    const cached = previousByParent.get(parent)
    const previous = cached?.frameID === el.ctx.frameId ? cached.previous : previousSiblings(parent, el.ctx.frameId)
    const value = margin(previous.get(el))
    if (el.marginTop !== value) el.marginTop = value
  }
}

function previousSiblings(parent: BaseRenderable, frameID: number) {
  const previous = new WeakMap<BaseRenderable, BaseRenderable | undefined>()
  parent.getChildren().forEach((child, index, children) => previous.set(child, children[index - 1]))
  previousByParent.set(parent, { frameID, previous })
  return previous
}

/** Slightly wider than the default shell so the homepage action row stays on one line. */
export const MAIN_CONTENT_MAX_WIDTH = 100
export const SESSION_CHAT_MAX_WIDTH = 132
export const SIDEBAR_WIDTH = 42
export const MAIN_CONTENT_HORIZONTAL_PADDING = 4

function boundedColumnWidth(terminalWidth: number, sidebarVisible: boolean, maxWidth: number) {
  const rail = terminalWidth - (sidebarVisible ? SIDEBAR_WIDTH : 0)
  return Math.min(maxWidth, Math.max(1, rail))
}

export function mainColumnWidth(terminalWidth: number, sidebarVisible: boolean) {
  return boundedColumnWidth(terminalWidth, sidebarVisible, MAIN_CONTENT_MAX_WIDTH)
}

export function sessionColumnWidth(terminalWidth: number, sidebarVisible: boolean, expanded = false) {
  return boundedColumnWidth(terminalWidth, sidebarVisible, expanded ? SESSION_CHAT_MAX_WIDTH : MAIN_CONTENT_MAX_WIDTH)
}

export function sessionContentWidth(terminalWidth: number, sidebarVisible: boolean, expanded = false) {
  return Math.max(1, sessionColumnWidth(terminalWidth, sidebarVisible, expanded) - MAIN_CONTENT_HORIZONTAL_PADDING)
}
