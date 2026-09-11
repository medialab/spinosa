import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  countDeliveredImportFiles,
  type PhaseAccumulator,
} from "../src/commands/onboard";
import {
  copySource,
  preserveFailedImportFiles,
  verifyAndRecoverImport,
  type ClassifiedEntry,
} from "../src/import/pipeline";

function phase(
  overrides: Partial<PhaseAccumulator["direct"]> = {},
): PhaseAccumulator["direct"] {
  return {
    converted: 0,
    skipped: 0,
    failed: 0,
    renamed: 0,
    recoverable: [],
    ...overrides,
  };
}

describe("onboarding delivery accounting", () => {
  test("counts skipped files as delivered for resume imports", () => {
    const acc: PhaseAccumulator = {
      direct: phase({ skipped: 2 }),
      markitdown: phase({ skipped: 1 }),
      vision: phase({ skipped: 0 }),
      ocr: phase({ skipped: 3 }),
    };

    expect(countDeliveredImportFiles(acc, 0)).toBe(6);
    expect(countDeliveredImportFiles(acc, 2)).toBe(8);
  });

  test("preserves failed source files under the review directory", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-failed-files-"));
    const source = path.join(root, "source.txt");
    const rawDir = path.join(root, "raw");
    writeFileSync(source, "keep me");

    const entry: ClassifiedEntry = {
      src: source,
      rel: "nested/source.txt",
      dest: path.join(rawDir, "nested", "source__txt.md"),
    };
    const result = await preserveFailedImportFiles([entry], rawDir);

    expect(result.failedFilePaths).toEqual(["nested/source.txt"]);
    expect(result.savedFilePaths).toEqual(["nested/source.txt"]);
    expect(readFileSync(path.join(rawDir, "_failed_files", entry.rel), "utf8")).toBe("keep me");
  });

  test("verification returns recovered file paths and uses source namespaces", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-verify-files-"));
    const source = path.join(root, "source");
    const rawDir = path.join(root, "raw");
    mkdirSync(source, { recursive: true });
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(path.join(source, "notes.md"), "# Notes\n");

    const result = await verifyAndRecoverImport(
      source,
      rawDir,
      undefined,
      false,
      false,
      undefined,
      undefined,
      rawDir,
      "source-2",
    );

    expect(result.missingFiles).toEqual(["source-2/notes.md"]);
    expect(result.recoveredFiles).toEqual(["source-2/notes.md"]);
    expect(result.stillMissingFiles).toEqual([]);
    expect(existsSync(path.join(rawDir, "source-2", "notes.md"))).toBe(true);
  });

  test("resume-only copy reports skipped files as terminal success", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-resume-import-"));
    const source = path.join(root, "source");
    const rawDir = path.join(root, "raw");
    mkdirSync(source, { recursive: true });
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(path.join(source, "notes.md"), "# Notes\n");
    writeFileSync(path.join(rawDir, "notes.md"), "already delivered\n");

    const events: Array<{ rel: string; status?: string }> = [];
    const result = await copySource(source, rawDir, {
      verifyAfter: false,
      onProgress: (_phase, _current, _total, rel, status) => events.push({ rel, status }),
    });

    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(events.some((event) => event.rel === "notes.md" && event.status === "done")).toBe(true);
  });

  test("verification recovery emits a terminal file status", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-verify-progress-"));
    const source = path.join(root, "source");
    const rawDir = path.join(root, "raw");
    mkdirSync(source, { recursive: true });
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(path.join(source, "notes.md"), "# Notes\n");

    const events: Array<{ phase: string; rel: string; status?: string }> = [];
    let removed = false;
    const result = await copySource(source, rawDir, {
      onProgress: (phase, _current, _total, rel, status) => {
        events.push({ phase, rel, status });
        if (phase === "direct-progress" && status === "done" && !removed) {
          removed = true;
          rmSync(path.join(rawDir, "notes.md"), { force: true });
        }
      },
    });

    expect(result.recovered).toBe(1);
    expect(events.some((event) =>
      event.phase === "verification" && event.rel === "notes.md" && event.status === "done",
    )).toBe(true);
  });
});
