# Spinosa — staff-engineer full-codebase audit

- **Date:** 2026-09-20
- **Branch / HEAD:** `beta-dev` @ `65f464c9` ("feat: ship v1.2.0-beta.12 with in-report Markdown figures")
- **Version:** `1.2.0-beta.12` (root `package.json`, `install.sh` `PINNED_VERSION`)
- **Dirty tree:** yes — in-flight beta-track upgrade work + session/footer scoping work (8 modified, 2 untracked). Audited as-is.
- **Scope:** all phases 0–7. No fixes applied; read-only audit.

---

## 1. Executive summary

Two ship-blockers, both P0, neither in the in-flight work:

1. **Provider API keys leave the process in plaintext.** `Provider.toPublicInfo()` does not redact
   `Info.key`. It is used for the `/provider` and `/config/providers` HTTP responses and is handed to
   third-party plugins. The name promises redaction it does not perform, and no test asserts it.
2. **`spinosa_verify` returns `pass` without verifying anything** for 11 of its 12 validators,
   including `report`. For `report` the entire check is "has an H1". The product promise is
   source-grounded claims; the tool that is supposed to enforce it is a structural stub.

Top 5 risks, ordered by damage × likelihood:

1. Provider key exposure via `toPublicInfo` (P0, security).
2. `spinosa_verify` / `write_report` let an agent self-declare `status: pass` with no verification
   ever run (P0, product truth — this is the core promise).
3. A failed launch-time upgrade throws and `process.exit(1)`, so the user cannot launch Spinosa at
   all; the new pinned-version installer URL widens the failure surface that reaches this path (P1).
4. If the installer writes `beta: false` and then post-install verification fails, the beta channel
   is never restored — the user is silently moved to the stable track *and* launch is blocked (P1).
5. `release-beta.yml` on `main` and on `beta-dev` are out of sync (15 insertions / 35 deletions).
   Tag releases run **main's** copy, so the pipeline reviewed on `beta-dev` is not the one that ships,
   and nothing enforces the sync the docs require (P1).

**Is it safe to cut a beta on this tree?** Yes for distribution mechanics — the build-once promotion
gate in `scripts/release/promote.ts` is genuinely fail-closed and well designed, and the installer's
checksum path is fail-closed. No, for the two P0s: shipping a research product whose `verify` tool
rubber-stamps reports, and which serves API keys over its own API, should block the cut. Both fixes
are small and local; neither requires touching the release pipeline.

The in-flight work (beta-track upgrade, footer, session scoping) is **substantially correct**. Its
real defect is not logic but coverage: **both new test files run in no gate at all.**

---

## 2. Architecture sketch (real runtime graph)

```text
curl install.sh ──> $SPINOSA_HOME/bin/spinosa (compiled from packages/spinosa-kernel/src/index.ts)
                    writes metadata/config.yaml: beta: <from PINNED_TAG>, last_installed_version

spinosa (no args)
  └─ spinosa-kernel/src/cli/cmd/tui.ts
       ├─ runOverlappedLaunch: spawns TUI worker  ∥  runs preflight
       │    preflight = spinosa-core/commands/preflight.ts::runLaunchPreflight
       │      └─ checkUpgradeAvailable()  (upgrade.ts)
       │           ├─ spinosaReleaseChannel()  <- metadata/config.yaml `beta:`
       │           ├─ refreshIfStaleOrMissing(channel)      fire-and-forget fetch
       │           ├─ refreshIfStaleOrMissing("stable")     only when channel=beta
       │           └─ pickLaunchUpgradeTarget()  <- reads version_check_cache_<channel>
       │      └─ upgradeFramework({version})  -> downloads v<X>/install.sh, verifies checksum,
       │           spawns bash installer, then restores `beta: true` on the success path only
       │      └─ THROWS on failure -> tui.ts process.exit(1)
       └─ cli/tui/layer.ts -> @spinosa/tui run()
            SpinosaWorkspaceProvider: activePath (KV) XOR genericMode
              ├─ routes/home.tsx  -> HomeFooter  (picker footer | workspace footer)
              └─ sync.tsx sessionListQuery() -> {directory} for Spinosa workspaces
                   └─ sessionMatchesWorkspaceScope (util/session.ts) applied in 3 places

server (loopback, or non-loopback only with SPINOSA_SERVER_PASSWORD)
  └─ /provider, /config/providers  -> Provider.toPublicInfo()  *** leaks Info.key ***

research loop (model-orchestrated, NOT engine-driven)
  spinosa_route -> general | orchestrated
    orchestrated: spinosa_frame plan names searcher/mapper/analyst/writer/verifier
    execution is instruction-only: packages/spinosa-runtime engine.ts / state.ts have no
    production caller, so every "mandatory" step is advisory
  write_report (status: draft|pass|pass_with_corrections)  <- agent picks the status
  spinosa_verify(validator) -> pass for everything except validator === "verification"
```

Two things this graph makes obvious that the org chart hides:

- The research **control plane does not exist at runtime.** `packages/spinosa-runtime/src/engine.ts`
  and `state.ts` are pure and unused in production; the orchestrating model is the scheduler. Every
  "mandatory verifier" statement in the skills is a request, not a constraint.
- Session scoping is **directory-only** in practice. The Spinosa workspace ID (`n_*`) is written to
  KV and never read for scoping.

---

## 3. Findings by severity

### P0

#### [P0] `Provider.toPublicInfo()` does not redact the API key it is named for

- **Where:** `packages/spinosa-kernel/src/provider/provider.ts:157` (`toPublicInfo`), field declared
  at `:132` (`key: optional(Schema.String)`), populated at `:796` and `:808`.
  Consumers: `src/server/routes/instance/httpapi/handlers/provider.ts:60`,
  `handlers/config.ts:27`, plugin trigger `provider.ts:1099`, plugin auth loader `provider.ts:830`.
- **User/runtime effect:** The plaintext provider API key is returned in the `/provider` and
  `/config/providers` HTTP responses, and passed to third-party plugin code. Any local process,
  plugin, or MCP server that can reach the server can read the user's OpenAI/Anthropic/etc. key.
  With `SPINOSA_SERVER_PASSWORD` set and a non-loopback bind, it goes over the network to any
  password-holding client.
- **Evidence:**

  ```157:170:packages/spinosa-kernel/src/provider/provider.ts
  export function toPublicInfo(provider: Info): Info {
    return JSON.parse(
      JSON.stringify(provider, (_, value) => {
        if (
          typeof value === "function" ||
          typeof value === "symbol" ||
          value === undefined
        )
          return undefined;
        if (typeof value === "bigint") return value.toString();
        return value;
      }),
    );
  }
  ```

  The replacer drops functions, symbols, `undefined`, and stringifies bigints. It never touches
  `key` or `options.apiKey`. Key population:

  ```806:809:packages/spinosa-kernel/src/provider/provider.ts
              mergeProvider(providerID, {
                source: "api",
                key: provider.key,
              });
  ```

- **Root cause:** `toPublicInfo` is a structural JSON deep-clone that was named as if it were a
  redaction boundary, so every caller trusts it as one. The one real mitigation in the codebase is
  elsewhere and partial: `packages/core/src/session/runner/model.ts:92` strips `apiKey` from the
  model HTTP body.
- **Fix direction:** Delete `key` (and `options.apiKey`) inside `toPublicInfo` before returning.
  Keep the deep-clone behavior; add the omission. Do not change the `Info` schema — internal callers
  still need `key`; instead stop routing internal reads through the public projection.
- **Test that should exist:** `toPublicInfo({...,key:"sk-test"})` must not contain `sk-test`, plus an
  HTTP-level assertion that the `/provider` response body contains no `sk-` substring for a
  configured API provider. Neither exists today (`rg toPublicInfo packages/spinosa-kernel/test` → no
  matches).
- **Mitigation already present:** `assertSecureBind` (`src/server/server.ts:96`) refuses a
  non-loopback bind without `SPINOSA_SERVER_PASSWORD`, which bounds remote exposure but not local
  processes or plugins.

#### [P0] `spinosa_verify` reports `pass` without checking any claim against any source

- **Where:** `packages/spinosa-core/src/application/agent-tools.ts:236-260` (`spinosaVerify`);
  validator list `:219-232`; report validator `packages/spinosa-core/src/artifacts/validate.ts:77-81`.
- **User/runtime effect:** An agent can call `spinosa_verify` on a finished report with
  `validator: "report"` and receive `{ok: true, status: "pass", action: "complete"}`. Nothing read
  the user's source documents. The report then carries a verified status the product never earned —
  which is exactly the guarantee Spinosa sells.
- **Evidence:**

  ```251:259:packages/spinosa-core/src/application/agent-tools.ts
    if (input.validator === "verification") {
      const { default: path } = await import("node:path")
      const { readFile } = await import("node:fs/promises")
      const text = await readFile(path.join(input.workspacePath, input.relativePath), "utf-8").catch(() => "")
      const status = parseVerificationStatus(text) ?? "fail"
      return { ok: true, status, action: verificationOutcome(status) }
    }
    return { ok: true, status: "pass", action: "complete" }
  ```

  Only `validator === "verification"` reads a file, and even then it only parses a status line the
  verifier agent wrote itself. The `report` validator it delegates to is:

  ```77:81:packages/spinosa-core/src/artifacts/validate.ts
      case "report": {
        const title = text.match(/^#\s+.+/m)
        if (!title) return { ok: false, error: "report missing title", retryable: true }
        return { ok: true }
      }
  ```

- **Root cause:** `validateArtifact` is a *shape* validator, and `spinosaVerify` treats "shape is
  valid" as "content is verified" for every validator except one. The naming collision between
  artifact validation and claim verification hid it.
- **Fix direction:** Make the non-`verification` branch return a status that cannot be read as a
  verification verdict — e.g. `{ok: true, status: "structure_ok", action: "complete"}` — so no
  caller or artifact can launder a shape check into `pass`. Reserve `pass` for the
  `verification` branch.
- **Test that should exist:** `spinosaVerify({validator:"report"})` on a report full of fabricated
  claims must not return `status: "pass"`.

### P1

#### [P1] `write_report` lets the writer self-declare `status: pass`

- **Where:** `packages/spinosa-kernel/src/tool/report.ts:38-40` (status literals), rendered into the
  artifact frontmatter at `:73`. Second implementation: `packages/core/src/tool/report.ts:28-55`.
- **User/runtime effect:** The writer agent — whose own skill says it produces drafts and does not
  verify (`.agents/skills/spinosa-writer/SKILL.md:144`) — can write
  `status: pass_with_corrections` at report-creation time. Combined with the P0 above there is no
  point in the chain where a `pass` is checked against sources.
- **Evidence:** `status: Schema.Literals(["draft", "pass", "pass_with_corrections"])` on the tool the
  writer calls. `workspace-template/CLAUDE.md:175` says "This is mandatory — never skip verifier",
  which is an instruction to a model, not a constraint on the tool.
- **Root cause:** One tool owns both authoring and verdict, with no separation of authority.
- **Fix direction:** Restrict `write_report` input to `draft`; let only the verifier path promote the
  status. Smallest version: drop the two non-draft literals from the `write_report` schema.
- **Test that should exist:** `write_report` rejects `status: "pass"`.

#### [P1] A failed launch-time upgrade blocks launching Spinosa entirely

- **Where:** `packages/spinosa-core/src/commands/preflight.ts:334-337`;
  caller `packages/spinosa-kernel/src/cli/cmd/tui.ts:396-400`.
- **User/runtime effect:** The user accepts an upgrade offer. Anything that makes the installer
  return non-zero — transient network failure, a 404 on the pinned asset, a disk-space `die`, a
  sandbox that blocks `bash` — throws, and `tui.ts` calls `process.exit(1)`. The user cannot open
  their research workspace at all until they discover `spinosa upgrade` or
  `SPINOSA_NO_UPGRADE_CHECK=1`. An optional upgrade became a hard launch dependency.
- **Evidence:**

  ```333:337:packages/spinosa-core/src/commands/preflight.ts
    const upgraded = await resolved.upgradeFramework({ version: available.latestVersion })
    if (!upgraded.success || !upgraded.newVersion) {
      const detail = upgraded.error ? `: ${upgraded.error}` : ""
      throw new Error(`Spinosa upgrade failed${detail}. Run 'spinosa upgrade' for details.`)
    }
  ```

  ```396:400:packages/spinosa-kernel/src/cli/cmd/tui.ts
        } catch (error) {
          bootLogError("tui.preflight", error)
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
          process.exit(1)
  ```

- **Root cause:** The throw predates the in-flight work, but the in-flight change made preflight pass
  an explicit `version`, so the installer URL moved from the rolling `beta/install.sh` (which always
  exists) to the immutable `v<version>/install.sh` resolved from a possibly-stale local cache. More
  inputs now reach this fail-hard path.
- **Fix direction:** Treat a failed *offered* upgrade as non-fatal: print the error, continue into
  the TUI. Preflight already has a "continue" contract for the decline path; reuse it. Reserve the
  throw for a corrupted install where launching is unsafe.
- **Test that should exist:** `runLaunchPreflight` returns `"continue"` (not throws) when
  `upgradeFramework` fails. Note the existing test locks in the opposite:
  `packages/spinosa-core/test/preflight.test.ts` "does not claim success when the framework upgrade
  fails" asserts the throw.

#### [P1] Channel restore is skipped on partial install failure, silently moving a beta user to stable

- **Where:** `packages/spinosa-core/src/commands/upgrade.ts:477-489`, placed after the post-install
  verification at `:466-475`.
- **User/runtime effect:** A beta user is offered a newer *stable* version (the intended new
  behavior). The versioned stable installer writes `beta: false`. If the post-install version probe
  then mismatches, `upgradeFramework` returns early with `success: false` and the restore block never
  runs. The user is now on the stable track with no notice, *and* (per the finding above) launch
  exits 1. Their next launch only ever offers stable.
- **Evidence:** the restore is gated behind the success path:

  ```466:489:packages/spinosa-core/src/commands/upgrade.ts
    const postInstallVersion = installedUpgradeVersion(resolvedVersion)
    if (postInstallVersion !== resolvedVersion) {
      return {
        success: false,
        // ... returns before the restore below
      }
    }

    // Versioned stable installers rewrite beta: false from PINNED_TAG. Keep the
    // user's existing beta track so the next beta still flows as normal.
    if (!explicitChannel && channel === "beta") {
      try {
        await setReleaseChannel("beta")
  ```

  That the installer really does rewrite the toggle is confirmed in `install.sh:1507`
  (`config_set_key "$config" "beta" "$(installer_beta_toggle)"`) with
  `installer_beta_toggle`/`installer_release_channel` at `:1377-1401` deriving the channel from
  `PINNED_TAG`, and `scripts/release/stages.ts:201` setting the versioned installer's
  `PINNED_TAG` to `paths.tag`.
- **Root cause:** The restore is modeled as a success-path finalizer, but the thing it repairs
  (the config write) happens earlier and independently, inside the installer.
- **Fix direction:** Restore the channel in a `finally`-style block keyed on "the installer ran",
  not on "the upgrade succeeded". `install.sh` already stages a `CONFIG_BACKUP`
  (`install.sh:1456-1462`) — the alternative smallest fix is to have the installer restore it on its
  own failure paths.
- **Test that should exist:** post-install version mismatch on a beta home leaves `beta: true`.

#### [P1] `spinosa upgrade` and launch preflight now disagree about what is available

- **Where:** `pickLaunchUpgradeTarget` (`packages/spinosa-core/src/commands/upgrade.ts:58-68`) is used
  only by `checkUpgradeAvailable` (`:605`). The `upgrade` command path resolves through
  `resolveReleaseVersionForChannel(channel)` (`:265`) with no cross-channel logic.
- **User/runtime effect:** A beta user who accepted the newer *stable* (say 1.2.1) now runs
  `spinosa upgrade` manually. It resolves the rolling beta pin (1.2.0-beta.12), which is lower than
  installed, and refuses: "Refusing to downgrade from v1.2.1 to v1.2.0-beta.12. Use --reinstall or
  --allow-downgrade to proceed." Meanwhile launch says "No updates available". Two entry points, two
  different stories, and the manual one reads like an error.
- **Evidence:** the downgrade refusal at `upgrade.ts:296-306` is reached because
  `resolvedVersion` comes from the channel-scoped resolve, not from `pickLaunchUpgradeTarget`.
- **Root cause:** The beta-track fix was applied to the launch probe only; the command kept the old
  single-channel resolution.
- **Fix direction:** Have the no-argument `upgrade` command resolve its target through
  `pickLaunchUpgradeTarget` too, so both entry points share one definition of "newer".
- **Test that should exist:** `spinosa upgrade` on a beta home whose installed version exceeds the
  beta pin reports "already current" rather than a downgrade refusal.

#### [P1] `release-beta.yml` differs between `main` and `beta-dev`, and the drift is unenforced

- **Where:** `.github/workflows/release-beta.yml` on both branches.
- **User/runtime effect:** GitHub resolves tag-triggered workflows from the default branch, so a
  `v*` push runs **main's** copy. The copy reviewed, linted by `quality`'s actionlint job, and
  reasoned about on `beta-dev` is not the one that ships the release.
- **Evidence:** `git diff --stat main -- .github/workflows/release-beta.yml` → `15 insertions(+),
  35 deletions(-)`. Structural differences: `main` is `name: Release` with stable-tag support
  (`v1.2.*`), channel/`checkout_ref` selection, and stable dry-runs from `main`; the `beta-dev` copy
  is beta-only with a hardcoded `beta-dev` dispatch checkout. `AGENTS.md:47-48` and
  `RELEASE_GUIDE.md:27-28` both state the sync requirement; no CI job checks it.
- **Root cause:** A documented human invariant with no mechanical gate.
- **Fix direction:** Add a check to `quality` (or the release validate job) that fails when the
  workflow file on the default branch differs from the current branch's copy — a content hash
  comparison is enough.
- **Test that should exist:** that gate itself; it is the test.

#### [P1] `RELEASE_GUIDE.md` still advertises OCR tools tarballs as published assets

- **Where:** `RELEASE_GUIDE.md:128` ("What gets published" table) contradicted by
  `RELEASE_GUIDE.md:168-173` ("OCR tools tarballs (removed)") in the same file. Also
  `AGENTS.md:55-57` still documents the deleted `scripts/build-tools-tarballs.ts` path while
  `AGENTS.md:74` says local OCR was removed; and a stale comment at `scripts/release/index.ts:226`.
- **User/runtime effect:** Operator and agent confusion during a cut; an operator following the table
  would look for four `spinosa-tools-*.tar.gz` assets that will never exist and could conclude the
  release is incomplete.
- **Evidence:** the code is correct and unambiguous —
  `packages/spinosa-core/src/distribution/contract.ts:103` `expectedImmutableReleaseAssets` contains
  no tools entries, `scripts/smoke-install.ts:94` errors if one is requested, and
  `scripts/release/tools-build.test.ts:10-29` asserts the builders are gone. Only the docs lie.
- **Fix direction:** Delete the four `spinosa-tools-*` rows from the `RELEASE_GUIDE.md` table and the
  `build-tools-tarballs.ts` paragraph from `AGENTS.md`.

#### [P1] Settings the TUI presents as saved are not persisted

Reported by the Phase 3 sweep; I have not re-traced each one, so treat the list as high-confidence
but unverified in detail.

- Auto-approve permissions toggle: `packages/tui/src/context/permission.tsx:11-22` mutates an
  in-memory store only; command at `src/app.tsx:1284-1290`. Resets on restart.
- Agent selection: `packages/tui/src/context/local.tsx:101-108` vs the model setting at `:326-342`
  which does call `save()`.
- Release-channel row: `packages/tui/src/component/dialog-spinosa-settings.tsx:53-59` shows an
  unconditional success toast with no `try/catch`, unlike `updateAutoUpgrade` at `:36-50`.
- **Fix direction:** persist, or relabel as session-scoped. The channel row should mirror the
  auto-upgrade row's error handling.

#### [P1] Abort/stop failures are swallowed while the UI proceeds

- **Where:** `packages/tui/src/util/stop-sessions.ts:48-49` (`await input.abort(sessionID).catch(() => {})`),
  callers include `src/component/dialog-session-list.tsx:366`, `src/app.tsx:841`, `:911`,
  `src/routes/session/index.tsx:958`, `src/component/prompt/index.tsx:471`.
- **User/runtime effect:** Esc-to-stop, session switch, or new-session can look successful while the
  previous run keeps consuming tokens in the background. In a product where runs cost money and
  write files, a silently-failed stop is a trust problem.
- **Fix direction:** Toast on abort failure; do not let navigation imply the abort succeeded.
- **Status:** reported by the Phase 3 sweep; the `.catch(() => {})` is quoted from the source but I
  did not reproduce the stuck-run scenario.

### P2

#### [P2] Both new test files for the in-flight work run in no gate

- **Where:** `packages/spinosa-core/test/launch-upgrade-target.test.ts` and
  `packages/tui/test/component/home-footer.test.ts` (both untracked, both passing).
- **Effect:** The only tests for the new beta-track target selection and the new footer-label rule
  execute in none of `bun run quality`, `bun run test:core`, or `bun run test:tui`. They pass only
  under a bare `bun test` in the package directory, which the repo tells agents not to do from root.
  The work looks tested and is not, in CI.
- **Evidence:** `scripts/quality-release.ts:27-48` (`CORE_RELEASE_TESTS`) omits
  `test/launch-upgrade-target.test.ts`; `:50-60` (`TUI_RELEASE_TESTS`) omits
  `test/component/home-footer.test.ts`. Root `package.json` `test:core` also omits the former;
  `test:tui` is `bun test --isolate test/spinosa/`, which cannot reach `test/component/`.
  `.github/workflows/quality.yml:36` shows `bun run quality` is the only functional gate in CI.
- **Fix direction:** Add both files to the two lists in `scripts/quality-release.ts`.
- **Test that should exist:** a meta-check that every `test/` file touched by a release-critical
  module is a member of one of the gate lists. See the next finding for why a meta-check is the real
  fix.

#### [P2] Two divergent definitions of "release-critical tests"

- **Where:** root `package.json` `test:core` vs `scripts/quality-release.ts:27-48`.
- **Effect:** The lists have drifted in both directions. `quality` (the only CI gate) includes
  `models.test.ts`, `promote.test.ts`, and three `packages/core` tests that `test:core` lacks.
  `test:core` includes `validate-tag.test.ts`, `tools-build.test.ts`, `yaml-config`, `uninstall`,
  `zip-hardened`, `ocr-support`, `pdf-scanned-ocr`, `resume`, `smoke-install`, and others that
  `quality` never runs. **`validate-tag.test.ts` is not in CI at all**, yet `validate-tag.ts` is the
  gate that authorizes every tag push (`release-beta.yml:91`).
- **Fix direction:** Make one list the source of truth and have the other import it. Add
  `validate-tag.test.ts` and `tools-build.test.ts` to the gate.

#### [P2] `verifyPromotedDist` skips checksum lines it cannot parse

- **Where:** `scripts/release/promote.ts:66-74`.
- **Effect:** The function documented as "fail-closed layout + checksum verification" silently skips
  any malformed line (`if (!match) continue`) and never asserts that `checksums.txt` actually covers
  every expected binary. The layout check at `:58-63` guarantees the files *exist*, so a
  `checksums.txt` with binary lines removed would verify clean. Reaching this requires write access
  to a green run's artifacts, so practical risk is low — but it is a fail-open branch inside the
  release pipeline's last gate.
- **Evidence:** `runVerifyLocal` in `stages.ts:290-298` is stricter for the same data.
- **Fix direction:** After the loop, assert the parsed set covers
  `expectedImmutableReleaseAssets(version)`.
- **Test that should exist:** `verifyPromotedDist` rejects a `checksums.txt` missing a binary entry.

#### [P2] `SPINOSA_ACTIVE_WORKSPACE_ID_KV` is write-only state, and wiring it in would break session lists

- **Where:** written at `packages/tui/src/context/spinosa-workspace.tsx:120`, cleared at `:168`,
  rolled back at `:93`; never read outside that file.
- **Effect:** Today this is harmless dead state, and it is *why* there is no `n_*` vs `wrk_*` mixup:
  the Spinosa workspace ID never reaches session scoping. But the new early return in
  `sessionMatchesWorkspaceScope` (`packages/tui/src/util/session.ts:71`) returns `false` whenever the
  session's `workspaceID` differs from the scope's. If someone later passes this `n_*` id as
  `scope.workspaceID`, every session carrying an experimental `wrk_*` id would be excluded and
  session lists would silently empty.
- **Note on the audit brief's premise:** the Spinosa workspace ID prefix is `n_` with 32 hex chars
  (`packages/spinosa-core/src/workspace/identity.ts`), not `spw_01_*`.
- **Fix direction:** Either delete the unused KV key, or add a comment and a type brand at
  `sessionMatchesWorkspaceScope` making the `wrk_*` ID space explicit.
- **Test that should exist:** `sessionMatchesWorkspaceScope` rejects an `n_*` value passed as
  `scope.workspaceID` (or the type system forbids it).

#### [P2] `sessionMatchesWorkspaceScope` AND-filters, contradicting the query it is paired with

- **Where:** `packages/tui/src/util/session.ts:69-74` vs `packages/tui/src/context/sync.tsx:231-233`.
- **Effect:** `sessionListQuery` deliberately sends `{directory}` alone with the comment "Prefer that
  over experimental workspace ID so we do not AND-filter and drop directory-bound sessions", and then
  the client-side matcher AND-filters anyway: a session in the right directory but bound to a
  different `wrk_*` id is dropped. Reachable only when an experimental workspace is current, which is
  uncommon in the product, so impact is narrow.
- **Fix direction:** Decide one policy and state it in one place. If directory is authoritative for
  Spinosa workspaces, do not let a foreign `wrk_*` veto a directory match.

#### [P2] The same scope matcher is applied in three places

- **Where:** `packages/tui/src/context/sync.tsx:290-295`,
  `packages/tui/src/component/dialog-session-list.tsx:113-118`, and again at `:159-163`.
- **Effect:** The third application is what fixes the unfiltered pinned/current "extras", so it is
  justified — but three call sites with slightly different guard conditions (only `sync.tsx` consults
  `KV.SESSION_DIRECTORY_FILTER`) is how the original leak survived.
- **Fix direction:** One helper that takes the filter-enabled flag and is called once per list.

#### [P2] Dead UI: the footer "Delete workspace" button can never render

- **Where:** `packages/tui/src/component/home-footer.tsx:95-102` pushes the shortcut under
  `spinosa.activePath && !spinosa.genericMode`; `buttons()` renders only inside
  `<Show when={isHomePicker()}>` at `:144`, where
  `isHomePicker = () => !spinosa.activePath || spinosa.genericMode` (`:109`) is the exact negation.
- **Effect:** Unreachable code, not a lost capability (workspace deletion also lives in
  `SpinosaPromptChips`). Pre-dates the in-flight change — `isHomePicker` and the `Show` came in
  `4e1a63b7`, the Delete push in `6ff94fc9`.
- **Fix direction:** Delete the block, or move it to `chatButtons()` where a workspace is active.

#### [P2] `spinosa_map` writes workspace files behind its own permission, not `edit`

- **Where:** `packages/spinosa-kernel/src/tool/spinosa-map.ts:78-83` asks
  `{permission: "spinosa_map", patterns: ["*"], always: ["*"]}`; the writes happen in
  `packages/spinosa-core/src/application/spinosa-map.ts:339` and `:415`.
- **Effect:** One "always allow" on `spinosa_map` grants ongoing filesystem writes under
  `agent_reports/` and `maps/` without ever showing an `edit` prompt. Contrast the kernel
  `write_report`, which does gate on `edit` (`src/tool/report.ts:175-182`).
- **Fix direction:** Add an `edit` permission assert on the resolved paths before writing.
- **Status:** reported by the Phase 4 sweep with quoted line numbers; I did not re-trace the write
  calls.

#### [P2] Context-overflow compaction can leave a session stuck `busy`

- **Where:** `packages/spinosa-kernel/src/session/processor.ts:574-584` (`ContextOverflowError` halt)
  vs the neighboring halt path at `:592` which does set idle.
- **Effect:** Session shows as working forever after a context overflow; the TUI prefers server
  status (`packages/tui/src/util/session.ts:15-20`) so the user has no way to see it is not running.
- **Fix direction:** Set a terminal or explicit compacting status on that branch.
- **Status:** Phase 4 sweep; not re-traced.

#### [P2] V1 "always allow" permissions are not persisted

- **Where:** `packages/spinosa-kernel/src/permission/index.ts:145-151` pushes into an in-memory
  `approved` set; the V2 path does persist (`packages/core/src/permission/saved.ts:54-68`).
- **Effect:** The user re-answers the same permission prompt every restart on the V1 session path.
- **Status:** Phase 4 sweep; not re-traced.

#### [P2] Installer bats do not cover the channel metadata write or the upgrade decision

- **Where:** `tests/installer/*.bats`.
- **Effect:** `write_install_metadata` / `installer_beta_toggle` (`install.sh:1454-1510`) is the
  mechanism behind the P1 channel-restore finding and has no bats coverage (only
  `doctor_unverified` is tested). `should_install` (the upgrade/skip decision) and
  `restore_binary_backup_if_needed` (rollback) are likewise uncovered.
- **Fix direction:** Add bats for `beta: true|false` derived from `PINNED_TAG`, and for
  `should_install` skip-vs-upgrade.

### P3

- `const direction = ...` at `packages/spinosa-core/src/commands/upgrade.ts:292` is assigned and never
  read. Delete it.
- `homeFooterLabels("workspace")` names the *chat/workspace-home* footer while `"picker"` names the
  general-home footer, but the component calls them `buttons` / `chatButtons` and the comment at
  `packages/tui/src/component/home-footer.tsx:111` still says "Chat keeps the prompt's keyboard"
  although `HomeFooter` only renders on the Home route. Align the vocabulary.
- The `--finalize-only` branch at `.github/workflows/release-beta.yml:189` is unreachable: the
  `assemble` job's own `if:` restricts it to `dry_run == 'true'`, so only the `--dry-run` branch can
  run. Drop the conditional or the job guard, whichever reflects the intent.
- `packages/tui/src/component/dialog-session-list.tsx:173`, `:219`, `:224`, `:237` use
  `session.workspaceID!` non-null assertions on an optional field. `recover()` is only meaningful for
  workspace-bound sessions, but the assertions document an invariant nothing enforces.
- The workflow comment at `.github/workflows/release-beta.yml:17` omits `parser-worker` from the
  smoke list that the contract and the code both include.

---

## 4. Cross-cutting bug classes

1. **Names that promise a guarantee the function does not provide.** `toPublicInfo` (redacts
   nothing), `spinosa_verify` (verifies nothing for 11 of 12 validators), `verifyPromotedDist`
   (skips lines it cannot parse). This is the single most productive lens in this codebase — every
   P0 here is an instance. Audit every `verify*`/`public*`/`validate*` symbol against its contract.
2. **Instruction-as-enforcement in the research loop.** `packages/spinosa-runtime`'s engine and state
   machine are pure and have no production caller; the orchestrating model is the scheduler. Every
   "mandatory" step in the skills is advisory. Any invariant that matters must move into a tool
   signature (as with the `write_report` status fix) rather than prose.
3. **Repair logic attached to the success path.** The `beta: true` restore only runs when the whole
   upgrade succeeded, though the damage it repairs happens mid-flight. Compensating actions belong in
   `finally`, keyed on "the risky thing started".
4. **Two lists, one concept.** `test:core` vs `CORE_RELEASE_TESTS`; `release-beta.yml` on `main` vs
   `beta-dev`; two `write_report` implementations (kernel + core); `.agents/skills/` at the repo root
   vs `workspace-template/.agents/`. Each pair has already drifted. Each needs one source of truth or
   a mechanical equality gate.
5. **Guards that are the negation of their render condition.** The footer Delete button. Cheap to
   grep for: a `Show when={X}` whose children branch on `!X`.
6. **Cache-first probes reading a cache they just asked to refresh.** `checkUpgradeAvailable` fires
   `refreshIfStaleOrMissing` and then reads the still-stale value synchronously. This is a deliberate
   fail-open design and I am *not* flagging it as a bug — but it means "No updates available" can be
   up to one TTL stale (beta 300 s, stable 3600 s), and any fix in this area must preserve the
   non-blocking launch.

---

## 5. Test / CI gap matrix vs the P0 paths

`bun run quality` is the **only** functional gate in CI (`.github/workflows/quality.yml:36`), and on
a real tag push even that is skipped — `release-beta.yml:100-101` runs `bun run quality` only when
`dry_run == 'true'`. That is defensible under build-once promotion (the promoted dry-run already ran
it on the same commit), but it means the tag path's sole gate is `validate-tag.ts`, whose own tests
are not in `quality`.

| P0 / P1 path | Covered in `quality`? | Gap |
| --- | --- | --- |
| Provider key never leaves the server | **No** | No test references `toPublicInfo`. Add a redaction unit test + an HTTP body assertion. |
| `spinosa_verify` cannot return `pass` unverified | **No** | No test asserts a fabricated-claim report fails. |
| `write_report` cannot self-declare `pass` | **No** | Schema permits it; no test forbids it. |
| Launch survives a failed upgrade | **Inverted** | `preflight.test.ts` asserts the throw, locking in the launch-blocking behavior. |
| Beta channel restored after installing a stable pin | **No** | New logic at `upgrade.ts:477`; no test, and no bats on `installer_beta_toggle`. |
| `pickLaunchUpgradeTarget` beta/stable preference | **No** | `test/launch-upgrade-target.test.ts` exists, passes, and is in no gate list. |
| Sessions scoped to one workspace (path boundary, foreign ID, extras) | **Partial** | `test/util/session.test.ts` is in `TUI_RELEASE_TESTS` and covers the matcher well. Nothing covers `DialogSessionList`'s use of it, so the extras/merge path is untested. |
| Sessions absent on general home | **Shape only** | `home-footer.test.ts` tests the pure label function, not the component's choice of kind — and it is in no gate. The invariant is untested. |
| Tag gate (`validate-tag`) | **No** | `validate-tag.test.ts` is in `test:core` only. |
| Promotion fails closed without a green dry-run | **Yes** | `promote.test.ts` is in `quality`. The `selectPromotionRun` + `status=success` + content-SHA design is sound. |
| Installer checksum fail-closed | **Yes** | `tests/installer/binary.bats` covers lookup/verify; `install.sh:1330` dies on missing entries. |
| Installer `beta:` metadata write | **No** | See P2. |
| tui-worker must not import `@napi-rs/canvas` | **Yes** | `packages/spinosa-kernel/test/cli/tui/worker-boot.test.ts:131-137`, plus the boot-noise smoke. |

---

## 6. Explicit non-findings (checked, fine — do not redo)

- **Build-once promotion is genuinely fail-closed.** `scripts/release/promote.ts` filters GitHub runs
  on `status=success` (so a failed verify leg excludes the run), and binds to the built commit via
  the `release-sha` artifact *content* rather than run metadata — which correctly handles the fact
  that dispatch runs report the default branch SHA. `assembled-dist` and `release-sha` both have
  90-day retention, matching the docs. No `--force`, env bypass, or rebuild-on-missing-artifact path
  exists. This is the best-engineered part of the repo.
- **Channel roll ordering is correct.** `publishVersion` → `channel` → `verifyRemote`
  (`scripts/release/index.ts:108`, `scripts/release/state.ts:7-16`); the rolling release is only
  touched after the immutable one is created. (One caveat: a `verifyRemote` failure leaves the
  channel already rolled — worth a decision, not a bug.)
- **`installUrlForChannel` + `pickLaunchUpgradeTarget` logic is correct.** Versioned URLs ignore the
  channel and point at the immutable tag; beta prefers a newer beta pin and falls back to a newer
  stable; stable never sees beta. The "install newer stable then restore beta" round trip does not
  loop on the next launch (I traced the version comparisons). The version cache is cleared after a
  successful install (`upgrade.ts:452-460`) and written atomically (`writeVersionCache`).
- **`sessionMatchesWorkspaceScope` path-boundary fix is correct.** `/ws` no longer matches `/ws-2`;
  trailing separators are normalized; both `/` and `\` boundaries handled; `workspaceID === undefined`
  is correctly not treated as a match. Tests cover the sibling-path and foreign-ID cases and pass.
- **No `n_*` vs `wrk_*` ID mixup exists today.** `project.workspace.current()` returns the
  experimental `wrk_*` id from `sdk.client.experimental.workspace.list()`
  (`packages/tui/src/context/project.tsx:90`), which is the correct ID space for
  `session.workspaceID`. The Spinosa `n_*` id is never used in scoping. (See the P2 latent trap.)
- **Sessions are correctly absent from the general-home footer** and the pinned/current "extras" in
  `DialogSessionList` are now scope-filtered. Both intended behaviors are implemented; only the
  tests are weak.
- **No `figures[]` on `write_report`** in either implementation
  (`packages/spinosa-kernel/src/tool/report.ts:27-54`, `packages/core/src/tool/report.ts:28-55`), and
  the parameters snapshot confirms it. Exactly one figure tool (`spinosa_figure` →
  `markdown-figure.ts`). No `spinosa-visualizer` product code survives.
- **No tools tarballs are built, staged, cached, published, or verified.**
  `expectedImmutableReleaseAssets` excludes them, `smoke-install.ts:94` errors on request, and
  `tools-build.test.ts` asserts the builders are deleted. Only prose is stale (P1 above).
- **DB migrations are forward-only and journal-guarded.** `packages/core/src/database/migration.ts:69`
  skips already-applied ids, so the destructive one-time transforms (`DELETE FROM session_message`,
  several `DROP COLUMN`) cannot replay. `migration --check` verifies generated artifacts against the
  schema.
- **`install.sh` is fail-closed on download and checksum.** `set -euo pipefail` at `:50`;
  checksums fetched and verified before activation (`:2792-2796`); `lookup_asset_checksum` dies on
  missing/duplicate/malformed entries (`:1330`); musl refused before download. No `curl | bash` in
  the runtime path (only in help text).
- **Server bind is safe by default.** `assertSecureBind` (`src/server/server.ts:96`) refuses a
  non-loopback bind without `SPINOSA_SERVER_PASSWORD`.
- **Bun-style `.ts` import extensions in `scripts/`** — repo-wide config noise, out of scope by
  instruction. Untouched.

---

## 7. Recommended next 5 tasks, by risk reduced per hour

1. **Redact `key` in `toPublicInfo` and add the two tests.** ~30 min. Removes a plaintext
   credential from an HTTP response and from third-party plugin input. Highest ratio in the repo.
2. **Stop `spinosa_verify` from returning `pass` for shape checks, and drop the non-draft literals
   from `write_report`.** ~1 h for both. Restores the product's central claim. Two small, local
   edits in `agent-tools.ts:259` and `report.ts:38`.
3. **Make a failed offered upgrade non-fatal, and move the `beta: true` restore off the success
   path.** ~1–2 h including the two tests and flipping the existing `preflight.test.ts` expectation.
   Removes the "cannot launch my workspace" and "silently moved to stable" pair.
4. **Add the two orphaned test files to `scripts/quality-release.ts`, add `validate-tag.test.ts` and
   `tools-build.test.ts` to the gate, and make `test:core` derive from one list.** ~1 h. Cheap, and
   it is what lets every fix above actually stay fixed.
5. **Add a CI check that `release-beta.yml` is identical on the default branch and the current
   branch.** ~1 h. Closes the gap where the reviewed pipeline is not the shipped pipeline.

Deliberately not recommended: any TUI rewrite, any change to the promotion/verification pipeline
design, any weakening of a gate, and any re-litigation of the removed OCR engine or visualizer.

---

## 8. Confidence ledger

**Confirmed by direct code reading (mine):** the two P0s; the launch-blocking throw; the
channel-restore ordering; the `upgrade`-vs-preflight disagreement; all test-gate membership gaps;
`main` vs `beta-dev` workflow drift; the dead footer Delete branch; `promote.ts` fail-closed design
and its checksum-line skip; artifact retention; `installer_beta_toggle` / `PINNED_TAG` derivation;
`pickLaunchUpgradeTarget` semantics; the `n_*` / `wrk_*` ID spaces; the `direction` dead variable.
All tests I ran passed (41 core, 14 TUI).

**Reported by a phase sweep and spot-verified by me:** `spinosa_verify` behavior and the `report`
validator (re-read both files); `toPublicInfo` consumers and key population (re-read); no `figures[]`
(re-read both schemas); the release workflow job graph (re-read the YAML).

**Reported by a phase sweep, quoted but not re-traced by me:** `spinosa_map` permission scope;
context-overflow stuck `busy`; V1 permission persistence; the TUI settings-persistence list; abort
error swallowing; onboarding success-before-open and the provider-step back no-op; prompt-queue
overwrite. Each carries a `path:line`; confirm before acting.

**Suspected, needs confirmation:** `pdfExtractPageTexts` has no `AbortSignal`
(`packages/spinosa-core/src/extension/pdf-js.ts:433`) — confirm whether a long single-file parse can
be cancelled. `session.time.compacting` may have no writer — confirm by grepping for assignments.

**Not audited:** `packages/sdk` / `protocol` / `schema` generated-vs-handwritten drift (Phase "SDK /
protocol" in the brief) beyond the two `write_report` copies; `website/`; `packages/spinosa-markitdown`
internals and scanned-PDF behavior; `packages/llm` transport beyond the key-handling question;
mutation/coverage gate quality.
