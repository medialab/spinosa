# TUI Screen Architecture Audit — 2026-07-09

## Screens Overview

| Screen | Lines | Steps | Status |
|--------|-------|-------|--------|
| `home.tsx` | 297 | 1 (static) | Active |
| `onboarding.tsx` | 1416 | 11 (path→name→tools→scan→imports→setup→direct→markitdown→ocr→verification→provider) | Active |
| `add-files.tsx` | 1135 | 7 (path→tools→scan→direct→markitdown→ocr→done) | Active |
| `workspace-picker.tsx` | 1069 | 3 (home→select→manager) | Active |
| `startup-hub.tsx` | 159 | N/A | **DEAD CODE** |
| `wizard-ui.tsx` | 237 | N/A (shared components) | Active |

## Issues Found

### 1. `startup-hub.tsx` is Dead Code (MEDIUM)

Referenced in `app.tsx` (import + JSX), `context/route.tsx` (type definition), `plugin/adapters.tsx` (route check) — but `routeForSetupStatus()` in `entry.ts` never returns `"startup-hub"`. The screen is unreachable. Superseded by inline `cli_started` handling in `workspace-picker.tsx`.

**Fix:** Remove `startup-hub.tsx`, its import from app.tsx, its JSX block, its route type, and the adapter check. ~30 lines to delete.

### 2. `runReinstall` Duplicated (MEDIUM)

Both `onboarding.tsx` (~lines 440-495) and `add-files.tsx` (~lines 380-445) have nearly identical `runReinstall` implementations. Same logic: detect tools, run `runReinstall` command, capture stdout/stderr, append to log, update tool checks.

**Fix:** Extract to a shared utility in `wizard-ui.tsx` or a new `spinosa/tool-repair.ts`.

### 3. Inconsistent Logging Patterns (MEDIUM)

| Screen | Logging methods used |
|--------|---------------------|
| `onboarding.tsx` | `tuiLog`, `logStep`, `logAction`, `logPhase`, `logTool`, `logResult`, `logError`, `logGate`, `appendLogLine` |
| `add-files.tsx` | `tuiLog`, `logAction`, `logError`, `logTool`, `appendLogLine` |
| `workspace-picker.tsx` | None (uses toasts and inline status) |

`onboarding.tsx` has rich structured logging. `add-files.tsx` uses a subset. `workspace-picker.tsx` uses nothing consistent.

**Fix:** Define a standard logging interface that all screens use. At minimum: `logStep`, `logAction`, `logError`, `appendLogLine`.

### 4. `busy` Signal Not Respected in Keyboard Handlers (LOW)

`onboarding.tsx` has a `stopActiveWork()` call in `handleBackPress` but not in `handleEnterPress`. If the user presses Enter while busy, actions can stack. `add-files.tsx` has the same pattern.

**Fix:** All action handlers should check `busy()` before proceeding. `handleEnterPress` in both screens should early-return if busy.

### 5. Toast Used Inconsistently (LOW)

`workspace-picker.tsx` uses toasts for upgrade status. `onboarding.tsx` and `add-files.tsx` use inline log panels instead. Three different UX patterns for "operation in progress."

**Fix:** Decide: either all screens use toasts for transient status, or all use inline logs. Don't mix.

### 6. `goHome` Navigates to Different Routes (LOW)

- `onboarding.tsx`: `navigate({ type: "home" })`
- `add-files.tsx`: `navigate({ type: "workspace" })`

Both are "go home" but go to different places. `add-files` goes to workspace (already in a workspace), `onboarding` goes to the home screen (no workspace yet). This is arguably correct but confusing naming.

**Fix:** Rename `goHome` in `add-files.tsx` to `goToWorkspace`.

---

## Architecture Patterns — What's Working

### Input Pattern (consistent)
All wizard screens receive context via SolidJS signals and props:
- `spinosa` context (active path, workspace metadata)
- `useExit()` for graceful shutdown
- `useNavigate()` for routing
- Route params for initial state

### State Management (mostly consistent)
```typescript
// Both onboarding and add-files use:
const [step, setStep] = createSignal<WizardStep>("path")
const [logLines, setLogLines] = createSignal<string[]>([])
const [busy, setBusy] = createSignal(false)
const [processingStatus, setProcessingStatus] = createSignal("")
```

### Shared UI Components (good)
`wizard-ui.tsx` exports `WizardPanel`, `WizardActionButton`, `ProgressBar`, `LogScrollbox` — used by both onboarding and add-files. This is the right pattern.

---

## Priority Actions

| # | What | Effort |
|---|------|--------|
| 1 | Extract `runReinstall` to shared utility | 30min |
| 2 | Standardize logging across all screens | 1h |
| 3 | Guard Enter key against `busy` state | 10min |
| 4 | Remove dead `startup-hub.tsx` | 15min |
| 5 | Rename `goHome` → `goToWorkspace` in add-files | 5min |

## Dead Code in Utility Layer (from AuditUtilities)

| File | Status | Superseded by |
|------|--------|---------------|
| `tui/src/spinosa/framework.ts` | DEAD | `@opencode-ai/spinosa-core/framework/discovery` |
| `tui/src/spinosa/classify.ts` | DEAD | `@opencode-ai/spinosa-core/classify/route` |
| `tui/src/spinosa/goal-artifact.ts` | DEAD | `@opencode-ai/spinosa-core/artifacts/goal` |
| `tui/src/spinosa/session-id.ts` | DEAD | `@opencode-ai/spinosa-core` |
| `tui/src/spinosa/parse-corpus.ts` | DEAD | `@opencode-ai/spinosa-core` |
| `tui/src/spinosa/parse-goal.ts` | DEAD | `@opencode-ai/spinosa-core` |

### Orphaned Exports on `service.ts`

4 exports never consumed by any screen: `SpinosaSdkSurface`, `fileBackedSdkSurface`, `listAuxiliaryArtifacts`, `readInstallReleaseChannel`.

### `routeForSetupStatus` is a Stub

Always returns `{type: "workspace"}` regardless of setup status. Real logic in `resolveSpinosaEntryRoute()`.

### `verify.ts` is Test-Only

Only used by scripts and tests — should move to `test/` or `scripts/`.
