#!/usr/bin/env bun

/** Run workspace coverage and fail checks without hiding unmeasured code. */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  defaultWorkspacePaths,
  parseLcov,
  runWorkspace,
  workspaceFromPath,
  type CoverageSummary,
  type Metric,
} from "./quality-coverage-lib";

export { parseLcov } from "./quality-coverage-lib";
export type {
  CoverageSummary,
  LcovRecord,
  Metric,
} from "./quality-coverage-lib";

const root = path.resolve(import.meta.dir, "..");

type Arguments = {
  check: boolean;
  minimum: number;
  output: string | undefined;
  workspaces: string[];
};

function parseArguments(argv: string[] = process.argv.slice(2)): Arguments {
  const requested = argv
    .find((argument) => argument.startsWith("--packages="))
    ?.slice("--packages=".length);
  const minimumText = argv
    .find((argument) => argument.startsWith("--min="))
    ?.slice("--min=".length);
  const output = argv
    .find((argument) => argument.startsWith("--output="))
    ?.slice("--output=".length);
  const minimum = minimumText === undefined ? 100 : Number(minimumText);

  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
    throw new Error("--min must be a number from 0 to 100");
  }

  const workspaces = requested
    ? requested
        .split(",")
        .map((workspace) => workspace.trim())
        .filter(Boolean)
    : [];
  const isSupported = (argument: string): boolean =>
    argument === "--check" ||
    argument.startsWith("--packages=") ||
    argument.startsWith("--min=") ||
    argument.startsWith("--output=");
  if (
    argv.some((argument) => argument.startsWith("--") && !isSupported(argument))
  ) {
    throw new Error("unknown quality coverage option");
  }
  if (argv.some((argument) => !argument.startsWith("--"))) {
    throw new Error("quality coverage accepts options only");
  }

  return {
    check: argv.includes("--check"),
    minimum,
    output,
    workspaces,
  };
}

function formatMetric(value: Metric): string {
  const percentage = !value.measured
    ? "unmeasured"
    : value.percent === null
      ? "n/a"
      : `${value.percent.toFixed(2)}%`;
  return `${percentage} (${value.hit}/${value.total})`;
}

function aggregateMetrics(results: CoverageSummary[]): CoverageSummary {
  const totals = results.reduce(
    (total, result) => ({
      tests: total.tests + result.tests,
      sourceFiles: total.sourceFiles + result.sourceFiles,
      instrumentedFiles: total.instrumentedFiles + result.instrumentedFiles,
      missingFiles: total.missingFiles + result.missingFiles,
      lines: {
        hit: total.lines.hit + result.lines.hit,
        total: total.lines.total + result.lines.total,
      },
      functions: {
        hit: total.functions.hit + result.functions.hit,
        total: total.functions.total + result.functions.total,
      },
      branches: {
        hit: total.branches.hit + result.branches.hit,
        total: total.branches.total + result.branches.total,
      },
    }),
    {
      tests: 0,
      sourceFiles: 0,
      instrumentedFiles: 0,
      missingFiles: 0,
      lines: { hit: 0, total: 0 },
      functions: { hit: 0, total: 0 },
      branches: { hit: 0, total: 0 },
    },
  );

  const metric = (name: "lines" | "functions" | "branches"): Metric => {
    const measured = results.some((result) => result[name].measured);
    return {
      hit: totals[name].hit,
      total: totals[name].total,
      percent:
        totals[name].total === 0
          ? null
          : (totals[name].hit / totals[name].total) * 100,
      measured,
    };
  };

  return {
    workspace: "aggregate",
    status: results.every((result) => result.status === "covered")
      ? "covered"
      : "failed",
    tests: totals.tests,
    sourceFiles: totals.sourceFiles,
    instrumentedFiles: totals.instrumentedFiles,
    missingFiles: totals.missingFiles,
    lines: metric("lines"),
    functions: metric("functions"),
    branches: metric("branches"),
  };
}

function checkFailures(
  results: CoverageSummary[],
  aggregate: CoverageSummary,
  minimum: number,
): string[] {
  const failures: string[] = [];
  for (const result of results) {
    if (result.status !== "covered") {
      failures.push(`${result.workspace}: ${result.error ?? result.status}`);
    }
    if (result.missingFiles > 0) {
      failures.push(
        `${result.workspace}: ${result.missingFiles} source file(s) have no coverage record`,
      );
    }
    for (const [name, value] of Object.entries({
      lines: result.lines,
      functions: result.functions,
      branches: result.branches,
    })) {
      if (!value.measured) {
        failures.push(`${result.workspace}: ${name} coverage is unmeasured`);
      } else if (value.percent !== null && value.percent < minimum) {
        failures.push(
          `${result.workspace}: ${name} coverage ${value.percent.toFixed(2)}% < ${minimum}%`,
        );
      }
    }
  }
  if (aggregate.missingFiles > 0) {
    failures.push(
      `aggregate: ${aggregate.missingFiles} source file(s) have no coverage record`,
    );
  }
  return failures;
}

export async function runCoverage(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const args = parseArguments(argv);
  const requested =
    args.workspaces.length > 0
      ? args.workspaces
      : await defaultWorkspacePaths();
  const results: CoverageSummary[] = [];

  for (const requestedWorkspace of requested) {
    const result = await runWorkspace(workspaceFromPath(requestedWorkspace));
    results.push(result);
    console.log(
      `${result.workspace}: status=${result.status}; tests=${result.tests}; source=${result.sourceFiles}; instrumented=${result.instrumentedFiles}; missing=${result.missingFiles}; lines=${formatMetric(result.lines)}; functions=${formatMetric(result.functions)}; branches=${formatMetric(result.branches)}`,
    );
  }

  const aggregate = aggregateMetrics(results);
  console.log(
    `aggregate: source=${aggregate.sourceFiles}; instrumented=${aggregate.instrumentedFiles}; missing=${aggregate.missingFiles}; lines=${formatMetric(aggregate.lines)}; functions=${formatMetric(aggregate.functions)}; branches=${formatMetric(aggregate.branches)}`,
  );

  if (args.output !== undefined) {
    const output = path.resolve(root, args.output);
    await mkdir(path.dirname(output), { recursive: true });
    await Bun.write(
      output,
      JSON.stringify({ minimum: args.minimum, results, aggregate }, null, 2) +
        "\n",
    );
  }

  if (!args.check) return 0;
  const failures = checkFailures(results, aggregate, args.minimum);
  if (failures.length > 0) {
    console.error(`coverage check failed (${failures.length} issue(s))`);
    for (const failure of failures) console.error(`- ${failure}`);
    return 1;
  }
  console.log(`coverage check passed at ${args.minimum}%`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await runCoverage();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
