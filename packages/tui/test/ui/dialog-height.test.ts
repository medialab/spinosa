import { describe, expect, test } from "bun:test"
import {
  DEFAULT_DIALOG_HEIGHT_RATIO,
  MARKDOWN_VIEWER_HEIGHT_RATIO,
  dialogMaxHeight,
} from "../../src/ui/dialog"

describe("dialogMaxHeight", () => {
  test("keeps default dialogs at 60 percent", () => {
    expect(DEFAULT_DIALOG_HEIGHT_RATIO).toBe(0.6)
    expect(dialogMaxHeight(50)).toBe(30)
  })

  test("sizes the markdown editor at 80 percent of the terminal", () => {
    expect(MARKDOWN_VIEWER_HEIGHT_RATIO).toBe(0.8)
    expect(dialogMaxHeight(50, MARKDOWN_VIEWER_HEIGHT_RATIO)).toBe(40)
    expect(dialogMaxHeight(100, MARKDOWN_VIEWER_HEIGHT_RATIO)).toBe(80)
  })

  test("shrinks near the terminal edges on short screens", () => {
    expect(dialogMaxHeight(20)).toBe(18)
    expect(dialogMaxHeight(20, MARKDOWN_VIEWER_HEIGHT_RATIO)).toBe(18)
  })
})
