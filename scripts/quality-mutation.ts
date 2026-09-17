#!/usr/bin/env bun

/** Run configured scoped mutation testing and preserve non-zero failures. */

import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const config = path.join(root, "stryker.config.mjs");

export function mutationCommand(
  strykerPath: string,
  extraArguments: string[] = [],
): string[] {
  return [
    strykerPath,
    "run",
    config,
    ...extraArguments.filter((argument) => argument !== "--"),
  ];
}

export async function runMutation(): Promise<number> {
  const stryker = path.join(root, "node_modules", ".bin", "stryker");
  if (!existsSync(stryker)) {
    console.error(
      "mutation: Stryker is not installed; install root dev dependencies before running this gate",
    );
    return 2;
  }
  if (!existsSync(config)) {
    console.error(`mutation: missing configuration ${config}`);
    return 2;
  }

  const child = Bun.spawn(
    mutationCommand(stryker, globalThis.process.argv.slice(2)),
    {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  return await child.exited;
}

if (import.meta.main) {
  try {
    process.exitCode = await runMutation();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
