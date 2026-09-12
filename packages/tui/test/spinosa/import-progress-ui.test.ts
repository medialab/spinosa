import { describe, expect, test } from "bun:test"
import {
  applyImportProgressStatus,
  countImportProgress,
  displaySpinosaLogsDir,
  formatImportDetailLogHint,
  formatImportPhaseRecap,
  formatImportPhaseRecapFromCounters,
  formatPageMarker,
  importOutcomeAccentKey,
  importOutcomeHeading,
  importPhaseVerb,
  isImportPhaseComplete,
  isTerminalImportFileStatus,
  resolveSpinosaLogsDir,
  seedImportQueue,
  selectImportFailedItems,
  selectImportQueueWindow,
  selectImportResultsWindow,
  selectImportSucceededItems,
  shortImportFileName,
  shouldShowImportDetailLogHint,
  splitPageSuffix,
  statusGlyph,
} from "../../src/spinosa/import-progress-ui"
import {
  importResultsListMaxHeight,
  scanOptionListMaxHeight,
  wizardPanelHeight,
} from "../../src/routes/spinosa/wizard-ui"

describe("import progress UI helpers", () => {
  test("shortImportFileName keeps basename and ellipsizes long names", () => {
    expect(shortImportFileName("spinosa-markitdown-test/vivatech_subset.xlsx")).toBe("vivatech_subset.xlsx")
    const long = "a".repeat(50) + ".xlsx"
    const short = shortImportFileName(`dir/${long}`, 20)
    expect(short.length).toBe(20)
    expect(short.includes("…")).toBe(true)
  })

  test("queue window prefers processing then queued", () => {
    const items = seedImportQueue(["a.md", "b.md", "c.md", "d.md", "e.md"])
    const mid = applyImportProgressStatus(items, "b.md", "processing")
    const window = selectImportQueueWindow(mid, 4)
    expect(window.map((i) => i.rel)).toEqual(["b.md", "a.md", "c.md", "d.md"])
    expect(window[0]?.status).toBe("processing")
  })

  test("failed list and glyphs", () => {
    let items = seedImportQueue(["ok.md", "bad.md"])
    items = applyImportProgressStatus(items, "ok.md", "done")
    items = applyImportProgressStatus(items, "bad.md", "failed")
    expect(selectImportFailedItems(items).map((i) => i.rel)).toEqual(["bad.md"])
    expect(statusGlyph("failed")).toBe("✗")
    expect(statusGlyph("processing")).toBe("›")
  })

  test("terminal file status is not downgraded by late processing ticks", () => {
    let items = seedImportQueue(["scan.pdf"])
    items = applyImportProgressStatus(items, "scan.pdf", "processing")
    items = applyImportProgressStatus(items, "scan.pdf", "done")
    items = applyImportProgressStatus(items, "scan.pdf", "processing")
    expect(items[0]?.status).toBe("done")
    expect(isTerminalImportFileStatus("done")).toBe(true)
    expect(isTerminalImportFileStatus("processing")).toBe(false)
  })

  test("succeeded list tracks done files during an in-flight phase", () => {
    let items = seedImportQueue(["a.jpg", "b.jpg", "c.jpg"])
    items = applyImportProgressStatus(items, "a.jpg", "done")
    items = applyImportProgressStatus(items, "b.jpg", "processing")
    expect(selectImportSucceededItems(items).map((i) => i.rel)).toEqual(["a.jpg"])
    expect(isImportPhaseComplete(1, 3, items)).toBe(false)
  })

  test("phase complete requires pending===0 when file list is present", () => {
    expect(isImportPhaseComplete(0, 0)).toBe(false)
    expect(isImportPhaseComplete(5, 10)).toBe(false)
    expect(isImportPhaseComplete(10, 10)).toBe(true)
    expect(isImportPhaseComplete(11, 10)).toBe(true)

    let items = seedImportQueue(["a.md", "b.md"])
    items = applyImportProgressStatus(items, "a.md", "done")
    // current>=total but one file still queued → not complete
    expect(isImportPhaseComplete(2, 2, items)).toBe(false)
    items = applyImportProgressStatus(items, "b.md", "processing")
    expect(isImportPhaseComplete(2, 2, items)).toBe(false)
    items = applyImportProgressStatus(items, "b.md", "done")
    expect(isImportPhaseComplete(1, 2, items)).toBe(true)
  })

  test("recap counts and phase-aware wording", () => {
    let items = seedImportQueue(["a.md", "b.md", "c.md"])
    items = applyImportProgressStatus(items, "a.md", "done")
    items = applyImportProgressStatus(items, "b.md", "failed")
    items = applyImportProgressStatus(items, "c.md", "done")
    expect(countImportProgress(items)).toEqual({ succeeded: 2, failed: 1, pending: 0 })
    expect(importPhaseVerb("MarkItDown conversion...")).toBe("converted")
    expect(importPhaseVerb("OCR...")).toBe("processed")
    expect(importPhaseVerb("Copying files...")).toBe("copied")
    expect(importPhaseVerb("")).toBe("succeeded")
    expect(formatImportPhaseRecap(countImportProgress(items), "MarkItDown conversion...")).toBe(
      "2 converted · 1 failed",
    )
  })

  test("recap includes pending and counter-only fallback avoids inventing failed:0", () => {
    let items = seedImportQueue(["a.md", "b.md", "c.md"])
    items = applyImportProgressStatus(items, "a.md", "done")
    expect(formatImportPhaseRecap(countImportProgress(items), "OCR...")).toBe(
      "1 processed · 0 failed · 2 pending",
    )
    expect(formatImportPhaseRecapFromCounters(7, "MarkItDown conversion...")).toBe("7 converted")
    expect(formatImportPhaseRecapFromCounters(7, "MarkItDown conversion...")).not.toContain("failed")
  })

  test("complete results list puts failures first and keeps every file", () => {
    let items = seedImportQueue(["a.md", "b.md", "c.md", "d.md", "e.md"])
    items = applyImportProgressStatus(items, "a.md", "done")
    items = applyImportProgressStatus(items, "b.md", "failed")
    items = applyImportProgressStatus(items, "c.md", "done")
    items = applyImportProgressStatus(items, "d.md", "error")
    items = applyImportProgressStatus(items, "e.md", "done")
    const ordered = selectImportResultsWindow(items)
    expect(ordered.map((i) => i.rel)).toEqual(["b.md", "d.md", "a.md", "c.md", "e.md"])
    expect(ordered.map((i) => i.status)).toEqual(["failed", "error", "done", "done", "done"])
  })

  test("import outcome accent is never success when failed or stillMissing", () => {
    expect(importOutcomeAccentKey({})).toBe("success")
    expect(importOutcomeAccentKey({ failedCount: 0, stillMissing: 0 })).toBe("success")
    expect(importOutcomeAccentKey({ failedCount: 1 })).toBe("error")
    expect(importOutcomeAccentKey({ stillMissing: 2 })).toBe("warning")
    expect(importOutcomeAccentKey({ failedCount: 1, stillMissing: 3 })).toBe("error")
    expect(importOutcomeHeading({ failedCount: 0, stillMissing: 0 })).toBe("● Import complete")
    expect(importOutcomeHeading({ stillMissing: 1 })).toBe("● Import complete with missing files")
    expect(importOutcomeHeading({ failedCount: 2 })).toBe("● Import complete with failures")
  })

  test("failure detail hint points at ~/.spinosa/logs without dumping the log body", () => {
    expect(shouldShowImportDetailLogHint({})).toBe(false)
    expect(shouldShowImportDetailLogHint({ failedCount: 0, stillMissing: 0 })).toBe(false)
    expect(shouldShowImportDetailLogHint({ failedCount: 1 })).toBe(true)
    expect(shouldShowImportDetailLogHint({ stillMissing: 2 })).toBe(true)
    expect(formatImportDetailLogHint("~/.spinosa/logs")).toBe("Spinosa saved details in ~/.spinosa/logs/")
    expect(formatImportDetailLogHint()).toBe(`Spinosa saved details in ${displaySpinosaLogsDir()}/`)
    expect(displaySpinosaLogsDir(resolveSpinosaLogsDir())).toMatch(/\/logs$/)
    expect(resolveSpinosaLogsDir().replace(/\\/g, "/")).toMatch(/\/logs$/)
  })

  test("page suffix splits to file base and page number", () => {
    expect(splitPageSuffix("memo.pdf (page 2)")).toEqual({ base: "memo.pdf", page: 2 })
    expect(splitPageSuffix("memo.pdf (page 3/12)")).toEqual({ base: "memo.pdf", page: 3, total: 12 })
    expect(splitPageSuffix("memo.pdf")).toEqual({ base: "memo.pdf" })
    expect(splitPageSuffix("dir/my (old) file.pdf")).toEqual({ base: "dir/my (old) file.pdf" })
    expect(formatPageMarker(2)).toBe(" (PG: 2)")
    expect(formatPageMarker(3, 12)).toBe(" (PG: 3/12)")
  })

  test("results ScrollBox max height stays inside the fixed wizard panel (~9 rows)", () => {
    expect(importResultsListMaxHeight(20)).toBe(6)
    expect(importResultsListMaxHeight(40)).toBe(9)
    expect(importResultsListMaxHeight(8)).toBe(5)
  })

  test("wizard panel height is fixed per terminal height with room for header and actions", () => {
    expect(wizardPanelHeight(40)).toBe(23)
    expect(wizardPanelHeight(30)).toBe(19)
    expect(wizardPanelHeight(24)).toBe(13)
    expect(wizardPanelHeight(16)).toBe(13)
  })

  test("option list height stays inside the fixed wizard panel (~12 rows)", () => {
    expect(scanOptionListMaxHeight(40)).toBe(12)
    expect(scanOptionListMaxHeight(24)).toBe(8)
    expect(scanOptionListMaxHeight(10)).toBe(4)
  })

  test("status updates match rows exactly, never by suffix substring", () => {
    // Regression: `apple/notes.txt` must NOT be updated by a tick for
    // `pineapple/notes.txt` (both share the same relative-path suffix).
    const items = seedImportQueue(["apple/notes.txt", "pineapple/notes.txt", "zap/notes.txt"])
    const updated = applyImportProgressStatus(items, "pineapple/notes.txt", "done")
    const apple = updated.find((i) => i.rel === "apple/notes.txt")
    const pineapple = updated.find((i) => i.rel === "pineapple/notes.txt")
    expect(pineapple?.status).toBe("done")
    expect(apple?.status).toBe("queued")
  })

  test("page-suffixed progress ticks still paint the owning file", () => {
    const items = seedImportQueue(["memo.pdf"])
    const updated = applyImportProgressStatus(items, "memo.pdf (page 2)", "processing")
    expect(updated.find((i) => i.rel === "memo.pdf")?.status).toBe("processing")
  })
})
