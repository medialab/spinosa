import { expect, test } from "bun:test"
import {
  clampMdViewerScale,
  MD_VIEWER_SCALE_DEFAULT,
  mdViewerSidePad,
  mdViewerTableCellPad,
} from "../../../src/routes/session/md-viewer-scale"

test("markdown viewer scale clamps to 1-5", () => {
  expect(clampMdViewerScale(undefined)).toBe(MD_VIEWER_SCALE_DEFAULT)
  expect(clampMdViewerScale(0)).toBe(1)
  expect(clampMdViewerScale(9)).toBe(5)
  expect(clampMdViewerScale(3.6)).toBe(4)
})

test("higher scale adds side padding", () => {
  expect(mdViewerSidePad(1)).toBe(0)
  expect(mdViewerSidePad(3)).toBe(4)
  expect(mdViewerSidePad(5)).toBe(8)
  expect(mdViewerTableCellPad(5)).toBe(1)
  expect(mdViewerTableCellPad(2)).toBe(0)
})
