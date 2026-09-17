/**
 * Scoped mutation configuration for the quality gate.
 *
 * Bun is used as a command runner because this repository's tests are Bun
 * tests, not Jest/Vitest tests. Keep this slice small enough for CI while
 * covering one representative pure module in each affected package.
 */
export default {
  testRunner: "command",
  commandRunner: {
    command:
      "bun --config=.quality/bunfig.coverage.toml test --timeout 30000 packages/spinosa-kernel/test/provider/transform.test.ts packages/llm/test/tool-runtime.test.ts packages/tui/test/ui/dialog-select-model.test.ts",
  },
  mutate: [
    "packages/spinosa-kernel/src/provider/transform.ts",
    "packages/llm/src/tool-runtime.ts",
    "packages/tui/src/ui/dialog-select-model.ts",
  ],
  coverageAnalysis: "off",
  reporters: ["clear-text", "json", "progress"],
  concurrency: 1,
  timeoutMS: 120000,
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },
};
