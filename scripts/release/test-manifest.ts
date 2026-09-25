/**
 * Single source of truth for release-critical tests.
 *
 * `bun run quality` (the only functional gate in CI) and `bun run test:core` /
 * `bun run test:tui` all read these lists. Two hand-maintained lists drifted in
 * both directions before this existed — `validate-tag.test.ts`, which guards
 * every tag push, was in no CI gate at all.
 *
 * Paths are relative to the package directory in each group.
 */

/** Run from `packages/spinosa-core`. */
export const CORE_RELEASE_TESTS = [
  "test/agent-model-policy.test.ts",
  "test/agent-tools.test.ts",
  "test/bun-launch.test.ts",
  "test/checksums.test.ts",
  "test/version.test.ts",
  "test/preflight.test.ts",
  "test/channels.test.ts",
  "test/upgrade-errors.test.ts",
  "test/upgrade-network.test.ts",
  "test/upgrade-channel-restore.test.ts",
  "test/launch-upgrade-target.test.ts",
  "test/uninstall.test.ts",
  "test/version-cache.test.ts",
  "test/distribution.test.ts",
  "test/workflow-gates.test.ts",
  "test/yaml-config.test.ts",
  "../../scripts/release/github.test.ts",
  "../../scripts/release/bump.test.ts",
  "../../scripts/release/lib.test.ts",
  "../../scripts/release/index.test.ts",
  "../../scripts/release/promote.test.ts",
  "../../scripts/release/tools-build.test.ts",
  "../../scripts/release/validate-tag.test.ts",
  "../../scripts/release/workflow-sync.test.ts",
  "../../scripts/set-version.test.ts",
  "../../scripts/smoke-install.test.ts",
  "../../packages/core/test/models.test.ts",
  "../../packages/core/test/sanitize-log.test.ts",
  "../../packages/core/test/user-dirs.test.ts",
  "../../packages/core/test/boot-log.test.ts",
] as const

/**
 * Extra `test:core` members that are slower or not release-gating. They run in
 * `bun run test:core` but stay out of the CI gate to keep it fast.
 */
export const CORE_EXTENDED_TESTS = [
  "test/fs-truncate.test.ts",
  "test/distribution-tools.test.ts",
  "test/pdf-engine.test.ts",
  "test/pdf-scanned-ocr.test.ts",
  "test/manifest-partial.test.ts",
  "test/destinations.test.ts",
  "test/zip-hardened.test.ts",
  "test/vision-abort.test.ts",
  "test/standalone.test.ts",
  "test/ocr-support.test.ts",
  "test/resume.test.ts",
] as const

/** Run from `packages/tui`. */
export const TUI_RELEASE_TESTS = [
  "test/context/local.test.ts",
  "test/util/session.test.ts",
  "test/util/stop-sessions.test.ts",
  "test/component/home-footer.test.ts",
  "test/spinosa/update-workspace.test.ts",
  "test/spinosa/create-workspace.test.ts",
  "test/spinosa/install-release.test.ts",
  "test/spinosa/boot.test.ts",
  "test/spinosa/preflight.test.ts",
  "test/spinosa/entry.test.ts",
  "test/spinosa/logging.test.ts",
  "test/cli/cmd/tui/provider-options.test.ts",
] as const

/**
 * Broad local sweep for `test:tui`: the whole Spinosa suite (62 files) plus the
 * gate members that live outside `test/spinosa/` — the old script was
 * `bun test --isolate test/spinosa/`, which could not reach `test/component/`.
 */
export const TUI_LOCAL_TEST_PATHS = [
  "test/spinosa/",
  ...TUI_RELEASE_TESTS.filter((file) => !file.startsWith("test/spinosa/")),
] as const

/** Run from `packages/spinosa-kernel`. */
export const KERNEL_RELEASE_TESTS = [
  "test/provider/public-info.test.ts",
  "test/server/httpapi-provider.test.ts",
  "test/tool/parameters.test.ts",
] as const
