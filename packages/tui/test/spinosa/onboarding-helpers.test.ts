import { describe, expect, test } from "bun:test";
import {
  formatBytes,
  initialToolChecks,
  mergeImportOptions,
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
    });
    expect(toolActionLabel(ready)).toBe("Scan source folders");
    expect(toolChecksReady(ready)).toBe(true);

    const missing = toolCheckResults({
      ocr: false,
      markitdown: true,
      pdfjs: true,
    });
    // Local OCR was removed: the ocr flag is ignored entirely (no OCR row).
    // The wizard continues to scan; only markitdown/pdfjs absence blocks.
    expect(toolActionLabel(missing)).toBe("Scan source folders");
    expect(onlyLocalOcrMissing(missing)).toBe(false);
    expect(toolChecksReady(missing)).toBe(true);

    const coreMissing = toolCheckResults({
      ocr: true,
      markitdown: false,
      pdfjs: true,
    });
    expect(toolActionLabel(coreMissing)).toBe("Reinstall missing tools");
    expect(onlyLocalOcrMissing(coreMissing)).toBe(false);
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
});
