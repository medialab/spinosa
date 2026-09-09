import { describe, expect, test } from "bun:test";

import { parseLcov } from "./quality-coverage";

describe("quality coverage lcov parser", () => {
  test("normalizes source paths and keeps only owned records", () => {
    const lcov = [
      "TN:",
      "SF:src/owned.ts",
      "FNF:2",
      "FNH:1",
      "LF:4",
      "LH:3",
      "end_of_record",
      "TN:",
      "SF:../other.ts",
      "FNF:1",
      "FNH:1",
      "LF:1",
      "LH:1",
      "end_of_record",
    ].join("\n");

    expect(parseLcov(lcov, "/repo/package", "/repo/package/src")).toEqual([
      {
        sourceFile: "/repo/package/src/owned.ts",
        lines: { hit: 3, total: 4, percent: 75, measured: true },
        functions: { hit: 1, total: 2, percent: 50, measured: true },
        branches: { hit: 0, total: 0, percent: null, measured: false },
      },
    ]);
  });

  test("rejects malformed counters instead of treating them as zero", () => {
    expect(() =>
      parseLcov(
        "SF:src/file.ts\nLF:not-a-number\nend_of_record",
        "/repo/package",
      ),
    ).toThrow("invalid LF counter");
  });

  test("rejects incomplete lcov records", () => {
    expect(() => parseLcov("SF:src/file.ts\nLF:1", "/repo/package")).toThrow(
      "lcov ended before end_of_record",
    );
  });
  test("reads branch-data records when aggregate counters are absent", () => {
    const lcov = [
      "SF:src/branch.ts",
      "FNF:1",
      "FNH:1",
      "LF:2",
      "LH:2",
      "BRDA:1,0,0,3",
      "BRDA:1,0,1,-",
      "end_of_record",
    ].join("\n");

    expect(parseLcov(lcov, "/repo/package")[0]?.branches).toEqual({
      hit: 1,
      total: 2,
      percent: 50,
      measured: true,
    });
  });
});
