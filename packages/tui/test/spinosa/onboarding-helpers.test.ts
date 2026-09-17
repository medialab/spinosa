import { describe, expect, test } from "bun:test";
import {
  formatBytes,
  formatScanProgress,
  initialToolChecks,
  mergeImportOptions,
  nextScanTotals,
  OCR_ENGINE_HINT_LINE,
  OCR_ENGINE_HINTS,
  onlyLocalOcrMissing,
  toolActionLabel,
  toolCheckResults,
  toolChecksReady,
  validateSinglePath,
  wavePulse,
  waveRow,
  waveString,
} from "../../src/routes/spinosa/onboarding-helpers";

describe("onboarding helpers", () => {
  test("formats byte sizes and renders deterministic waves", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(12_000)).toBe("12.0 KB");
    expect(formatBytes(12_000_000)).toBe("12.0 MB");
    expect(formatBytes(12_000_000_000)).toBe("12.0 GB");
    expect(waveString(0)).toHaveLength(6);
    expect(wavePulse(0)).toBe("▁");
    expect(waveRow(0, 4)).toHaveLength(4);
  });

  test("derives tool states and actions", () => {
    const checking = initialToolChecks();
    expect(toolActionLabel(checking)).toBe("Checking...");
    expect(toolChecksReady(checking)).toBe(false);

    const ready = toolCheckResults({
      ocr: true,
      markitdown: true,
      pdfjs: true,
      canvas: true,
    });
    expect(toolActionLabel(ready)).toBe("Scan source folders");
    expect(toolChecksReady(ready)).toBe(true);
    expect(ready.map((row) => row.label)).toEqual(["MarkItDown", "PDF.js", "Canvas"]);

    const missing = toolCheckResults({
      ocr: false,
      markitdown: true,
      pdfjs: true,
      canvas: true,
    });
    // Local OCR was removed: the ocr flag is ignored entirely (no OCR row).
    // The wizard continues to scan; only markitdown/pdfjs/canvas absence blocks.
    expect(toolActionLabel(missing)).toBe("Scan source folders");
    expect(onlyLocalOcrMissing(missing)).toBe(false);
    expect(toolChecksReady(missing)).toBe(true);

    const coreMissing = toolCheckResults({
      ocr: true,
      markitdown: false,
      pdfjs: true,
      canvas: true,
    });
    expect(toolActionLabel(coreMissing)).toBe("Reinstall missing tools");
    expect(onlyLocalOcrMissing(coreMissing)).toBe(false);

    const canvasMissing = toolCheckResults({
      ocr: false,
      markitdown: true,
      pdfjs: true,
      canvas: false,
    });
    expect(toolActionLabel(canvasMissing)).toBe("Reinstall missing tools");
    expect(toolChecksReady(canvasMissing)).toBe(false);
  });

  test("engine hint line composes from per-engine hints", () => {
    expect(OCR_ENGINE_HINT_LINE).toContain(OCR_ENGINE_HINTS.vision);
    expect(OCR_ENGINE_HINT_LINE).toContain(OCR_ENGINE_HINTS.none);
    expect(OCR_ENGINE_HINT_LINE).toContain("enter continue");
  });

  test("merges import options by extension", () => {
    const target = [{ ext: "txt", count: 1, bytes: 2, selected: true }];
    const result = mergeImportOptions(target, [
      { ext: "txt", count: 3, bytes: 4, selected: false },
      { ext: "pdf", count: 1, bytes: 8, selected: true },
    ]);
    expect(result).toEqual([
      { ext: "txt", count: 4, bytes: 6, selected: true },
      { ext: "pdf", count: 1, bytes: 8, selected: true },
    ]);
  });

  test("validates existing files and folders", () => {
    expect(validateSinglePath("/definitely/missing/spinosa-source")).toBe(
      "invalid",
    );
  });

  test("scan progress treats discovered as a running total, not a delta", () => {
    let scanTotal = 0;
    let scanCount = 0;
    for (let i = 1; i <= 1447; i++) {
      ({ scanTotal, scanCount } = nextScanTotals(i - 1, false, scanCount));
      ({ scanTotal, scanCount } = nextScanTotals(i, true, scanCount));
    }
    expect(scanCount).toBe(1447);
    expect(scanTotal).toBe(1447);
    expect(scanTotal).not.toBe(1447 * 1447);
  });

  test("formats scan progress without a fake denominator", () => {
    expect(formatScanProgress(1)).toBe("Scanning 1 file");
    expect(formatScanProgress(1447)).toBe("Scanning 1447 files");
  });
});
