import { describe, expect, test } from "bun:test"
import {
  MAIN_CONTENT_MAX_WIDTH,
  mainColumnWidth,
  SESSION_CHAT_MAX_WIDTH,
  sessionColumnWidth,
  sessionContentWidth,
  SIDEBAR_WIDTH,
} from "../../src/util/layout"

describe("layout constants", () => {
  test("uses the widened homepage/main-shell cap", () => {
    expect(MAIN_CONTENT_MAX_WIDTH).toBe(100)
    expect(SESSION_CHAT_MAX_WIDTH).toBe(132)
    expect(SIDEBAR_WIDTH).toBe(42)
  })

  test("caps wide terminals", () => {
    expect(mainColumnWidth(200, true)).toBe(100)
    expect(sessionContentWidth(200, true)).toBe(96)
  })

  test("shrinks on narrow terminals", () => {
    expect(mainColumnWidth(100, true)).toBe(58)
  })

  test("allows the session transcript to widen for rail mode", () => {
    expect(sessionColumnWidth(200, false, true)).toBe(132)
    expect(sessionContentWidth(200, false, true)).toBe(128)
    expect(sessionContentWidth(120, true, true)).toBe(74)
  })
})
