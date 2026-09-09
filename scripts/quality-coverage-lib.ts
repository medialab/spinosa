import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const coverageBunfig = path.join(root, ".quality", "bunfig.coverage.toml");
const executableExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const ignoredDirectories = new Set([
  ".git",
  ".stryker-tmp",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

export type Metric = {
  hit: number;
  total: number;
  percent: number | null;
  measured: boolean;
};

export type CoverageSummary = {
  workspace: string;
  status: "covered" | "failed" | "no-tests" | "missing-report";
  tests: number;
  sourceFiles: number;
  instrumentedFiles: number;
  missingFiles: number;
  lines: Metric;
  functions: Metric;
  branches: Metric;
  error?: string;
};

type Manifest = {
  workspaces?: {
    packages?: string[];
  };
};

export type LcovRecord = {
  sourceFile: string;
  lines: Metric;
  functions: Metric;
  branches: Metric;
};

export type Workspace = {
  name: string;
  cwd: string;
  sourceRoot: string;
  root: boolean;
};

function metric(hit: number, total: number, measured = true): Metric {
  return {
    hit,
    total,
    percent: total === 0 ? null : (hit / total) * 100,
    measured,
  };
}

function parseCounter(raw: string, field: string, line: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`invalid ${field} counter in lcov line: ${line}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`invalid ${field} counter in lcov line: ${line}`);
  }
  return value;
}

function parseLcovRecord(lines: string[], cwd: string): LcovRecord {
  let sourceFile: string | undefined;
  let linesFound = 0;
  let linesHit = 0;
  let functionsFound = 0;
  let functionsHit = 0;
  let branchesFound = 0;
  let branchesHit = 0;
  let linesMeasured = false;
  let functionsMeasured = false;
  let branchCountersMeasured = false;
  let lineTotalSeen = false;
  let lineHitSeen = false;
  let functionTotalSeen = false;
  let functionHitSeen = false;
  let branchTotalSeen = false;
  let branchHitSeen = false;
  let branchDataFound = 0;
  let branchDataHit = 0;

  for (const line of lines) {
    if (line.startsWith("SF:")) {
      const rawSourceFile = line.slice(3);
      if (rawSourceFile.length === 0) {
        throw new Error("lcov record has an empty SF");
      }
      sourceFile = path.resolve(cwd, rawSourceFile);
    } else if (line.startsWith("LF:")) {
      linesFound = parseCounter(line.slice(3), "LF", line);
      linesMeasured = true;
      lineTotalSeen = true;
    } else if (line.startsWith("LH:")) {
      linesHit = parseCounter(line.slice(3), "LH", line);
      linesMeasured = true;
      lineHitSeen = true;
    } else if (line.startsWith("FNF:")) {
      functionsFound = parseCounter(line.slice(4), "FNF", line);
      functionsMeasured = true;
      functionTotalSeen = true;
    } else if (line.startsWith("FNH:")) {
      functionsHit = parseCounter(line.slice(4), "FNH", line);
      functionsMeasured = true;
      functionHitSeen = true;
    } else if (line.startsWith("BRF:")) {
      branchesFound = parseCounter(line.slice(4), "BRF", line);
      branchCountersMeasured = true;
      branchTotalSeen = true;
    } else if (line.startsWith("BRH:")) {
      branchesHit = parseCounter(line.slice(4), "BRH", line);
      branchCountersMeasured = true;
      branchHitSeen = true;
    } else if (line.startsWith("BRDA:")) {
      const hits = line.slice(5).split(",")[3];
      if (hits === undefined) {
        throw new Error(`invalid BRDA record in lcov line: ${line}`);
      }
      branchDataFound += 1;
      branchDataHit +=
        hits === "-" || parseCounter(hits, "BRDA", line) === 0 ? 0 : 1;
    }
  }

  if (sourceFile === undefined) {
    throw new Error("lcov record is missing SF");
  }
  if (
    !lineTotalSeen ||
    !lineHitSeen ||
    !functionTotalSeen ||
    !functionHitSeen
  ) {
    throw new Error(
      `lcov record for ${sourceFile} is missing line/function counters`,
    );
  }
  if (branchCountersMeasured && (!branchTotalSeen || !branchHitSeen)) {
    throw new Error(`lcov record for ${sourceFile} is missing branch counters`);
  }
  if (!branchCountersMeasured && branchDataFound > 0) {
    branchesFound = branchDataFound;
    branchesHit = branchDataHit;
  }

  return {
    sourceFile,
    lines: metric(linesHit, linesFound, linesMeasured),
    functions: metric(functionsHit, functionsFound, functionsMeasured),
    branches: metric(
      branchesHit,
      branchesFound,
      branchCountersMeasured || branchDataFound > 0,
    ),
  };
}

export function parseLcov(
  text: string,
  cwd: string,
  sourceRoot?: string,
): LcovRecord[] {
  const records: LcovRecord[] = [];
  let current: string[] = [];
  const ownedRoot =
    sourceRoot === undefined ? undefined : path.resolve(sourceRoot) + path.sep;

  for (const line of text.split(/\r?\n/)) {
    if (line === "end_of_record") {
      if (current.length > 0) {
        const record = parseLcovRecord(current, cwd);
        if (
          ownedRoot === undefined ||
          record.sourceFile.startsWith(ownedRoot)
        ) {
          records.push(record);
        }
      }
      current = [];
    } else if (line.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    throw new Error("lcov ended before end_of_record");
  }
  if (records.length === 0) {
    throw new Error("lcov contains no records for requested source root");
  }
  return records;
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function isTestFile(file: string): boolean {
  const name = path.basename(file);
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) ||
    /_test_\.[cm]?[jt]sx?$/.test(name)
  );
}

async function sourceFiles(sourceRoot: string): Promise<string[]> {
  if (!existsSync(sourceRoot)) return [];
  const files = await listFiles(sourceRoot);
  return files.filter((file) => {
    const extension = path.extname(file);
    return (
      executableExtensions.has(extension) &&
      !file.endsWith(".d.ts") &&
      !isTestFile(file)
    );
  });
}

async function testFiles(cwd: string): Promise<string[]> {
  const files = await listFiles(cwd);
  return files.filter(isTestFile).sort();
}

async function readManifest(): Promise<Manifest> {
  return (await Bun.file(path.join(root, "package.json")).json()) as Manifest;
}

async function expandWorkspacePattern(pattern: string): Promise<string[]> {
  if (!pattern.includes("*")) return [pattern];
  const separator = pattern.lastIndexOf("/");
  const parentPattern = separator < 0 ? "." : pattern.slice(0, separator);
  const namePattern = separator < 0 ? pattern : pattern.slice(separator + 1);
  const parent = path.resolve(root, parentPattern);
  const expression = new RegExp(
    `^${namePattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );
  const entries = await readdir(parent, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && expression.test(entry.name))
    .map((entry) => path.join(parentPattern, entry.name));
}

export async function defaultWorkspacePaths(): Promise<string[]> {
  const manifest = await readManifest();
  const patterns = manifest.workspaces?.packages ?? [];
  const expanded = (
    await Promise.all(patterns.map(expandWorkspacePattern))
  ).flat();
  const packagePaths = expanded.filter((workspace) =>
    existsSync(path.join(root, workspace, "package.json")),
  );

  // Root release scripts are excluded by bunfig.toml from normal `bun test`.
  return [".", ...packagePaths.filter((workspace) => workspace !== ".")];
}

export function workspaceFromPath(workspacePath: string): Workspace {
  const normalized =
    workspacePath === "."
      ? "."
      : workspacePath.replaceAll("\\", "/").replace(/\/$/, "");
  const cwd = path.resolve(root, normalized);
  if (cwd !== root && !cwd.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${workspacePath} is outside repository root`);
  }
  if (!existsSync(path.join(cwd, "package.json"))) {
    throw new Error(`${workspacePath} has no package.json`);
  }
  return {
    name: normalized,
    cwd,
    sourceRoot: path.join(cwd, normalized === "." ? "script" : "src"),
    root: normalized === ".",
  };
}

function emptySummary(
  workspace: Workspace,
  status: CoverageSummary["status"],
  tests: number,
  sourceFileCount: number,
  error?: string,
): CoverageSummary {
  return {
    workspace: workspace.name,
    status,
    tests,
    sourceFiles: sourceFileCount,
    instrumentedFiles: 0,
    missingFiles: sourceFileCount,
    lines: metric(0, 0, false),
    functions: metric(0, 0, false),
    branches: metric(0, 0, false),
    ...(error === undefined ? {} : { error }),
  };
}

export async function runWorkspace(
  workspace: Workspace,
): Promise<CoverageSummary> {
  const tests = await testFiles(
    workspace.root ? path.join(workspace.cwd, "script") : workspace.cwd,
  );
  const sources = await sourceFiles(workspace.sourceRoot);

  if (tests.length === 0) {
    return emptySummary(workspace, "no-tests", 0, sources.length);
  }

  const coverageDir = await mkdtemp(path.join(tmpdir(), "spinosa-coverage-"));
  try {
    const command = [
      "test",
      ...(workspace.root ? [`--config=${coverageBunfig}`] : []),
      "--coverage",
      "--coverage-reporter=lcov",
      `--coverage-dir=${coverageDir}`,
      "--timeout",
      "30000",
      ...(workspace.root ? tests : []),
    ];
    const child = Bun.spawn(["bun", ...command], {
      cwd: workspace.cwd,
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) {
      return emptySummary(
        workspace,
        "failed",
        tests.length,
        sources.length,
        `tests failed (exit ${exitCode})`,
      );
    }

    const lcovPath = path.join(coverageDir, "lcov.info");
    if (!existsSync(lcovPath)) {
      return emptySummary(
        workspace,
        "missing-report",
        tests.length,
        sources.length,
        "tests produced no lcov.info",
      );
    }

    let records: LcovRecord[];
    try {
      records = parseLcov(
        await Bun.file(lcovPath).text(),
        workspace.cwd,
        workspace.sourceRoot,
      );
    } catch (error) {
      return emptySummary(
        workspace,
        "missing-report",
        tests.length,
        sources.length,
        error instanceof Error ? error.message : String(error),
      );
    }

    const instrumented = new Set(records.map((record) => record.sourceFile));
    const linesMeasured = records.some((record) => record.lines.measured);
    const functionsMeasured = records.some(
      (record) => record.functions.measured,
    );
    const branchesMeasured = records.some((record) => record.branches.measured);
    const missingFiles = sources.filter(
      (source) => !instrumented.has(path.resolve(source)),
    ).length;
    const totals = records.reduce(
      (total, record) => ({
        lines: {
          hit: total.lines.hit + record.lines.hit,
          total: total.lines.total + record.lines.total,
        },
        functions: {
          hit: total.functions.hit + record.functions.hit,
          total: total.functions.total + record.functions.total,
        },
        branches: {
          hit: total.branches.hit + record.branches.hit,
          total: total.branches.total + record.branches.total,
        },
      }),
      {
        lines: { hit: 0, total: 0 },
        functions: { hit: 0, total: 0 },
        branches: { hit: 0, total: 0 },
      },
    );

    return {
      workspace: workspace.name,
      status: "covered",
      tests: tests.length,
      sourceFiles: sources.length,
      instrumentedFiles: instrumented.size,
      missingFiles,
      lines: metric(totals.lines.hit, totals.lines.total, linesMeasured),
      functions: metric(
        totals.functions.hit,
        totals.functions.total,
        functionsMeasured,
      ),
      branches: metric(
        totals.branches.hit,
        totals.branches.total,
        branchesMeasured,
      ),
    };
  } finally {
    await rm(coverageDir, { force: true, recursive: true });
  }
}
