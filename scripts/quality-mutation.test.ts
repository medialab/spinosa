import { describe, expect, test } from "bun:test";

import { mutationCommand } from "./quality-mutation";

describe("quality mutation command", () => {
  test("uses repository Stryker config as positional config argument", () => {
    const command = mutationCommand("/repo/node_modules/.bin/stryker");
    expect(command).toEqual([
      "/repo/node_modules/.bin/stryker",
      "run",
      expect.stringContaining("/stryker.config.mjs"),
    ]);
  });

  test("forwards explicit Stryker flags without forwarding Bun's separator", () => {
    expect(mutationCommand("/repo/stryker", ["--", "--dryRunOnly"])).toEqual([
      "/repo/stryker",
      "run",
      expect.stringContaining("/stryker.config.mjs"),
      "--dryRunOnly",
    ]);
  });
});
