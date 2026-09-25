import { beforeAll, expect, mock, test } from "bun:test"

// Component-only deps (drag/drop, tooltips) need a browser and break the
// shared module registry in full-suite runs. Stub them: this file exercises
// only the pure DOM helper below.
mock.module("@thisbeyond/solid-dnd", () => ({
  DragDropProvider: () => null,
  DragDropSensors: () => null,
  DragOverlay: () => null,
  SortableProvider: () => null,
  closestCenter: () => null,
}))

mock.module("@/utils/solid-dnd", () => ({
  ConstrainDragXAxis: () => null,
}))

mock.module("@spinosa/ui/tooltip", () => ({
  Tooltip: () => null,
  TooltipKeybind: () => null,
}))

mock.module("@spinosa/ui/icon-button", () => ({
  IconButton: () => null,
}))

let setSidebarHidden!: (element: HTMLElement, hidden: boolean, focusTarget?: HTMLElement | null) => void

beforeAll(async () => {
  ;({ setSidebarHidden } = await import("./sidebar-shell"))
})

test("hiding a sidebar moves focus out and removes its controls from navigation", () => {
  const toggle = document.createElement("button")
  const panel = document.createElement("div")
  const item = document.createElement("button")
  panel.append(item)
  document.body.append(toggle, panel)

  try {
    item.focus()
    setSidebarHidden(panel, true, toggle)
    expect(document.activeElement).toBe(toggle)
    expect(panel.hasAttribute("inert")).toBe(true)
    expect(panel.getAttribute("aria-hidden")).toBe("true")

    setSidebarHidden(panel, false, toggle)
    expect(panel.hasAttribute("inert")).toBe(false)
    expect(panel.hasAttribute("aria-hidden")).toBe(false)
  } finally {
    panel.remove()
    toggle.remove()
  }
})
