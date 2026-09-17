# Handoff — Spinosa Core Migration Status

## Project Context

Spinosa research framework: Bash CLI → TypeScript migration. All core logic ported to `@opencode-ai/spinosa-core` at `packages/spinosa-core/`. Both TUI (`bun run dev`) and new TS CLI (`bun run packages/spinosa-core/bin/spinosa.ts`) consume the same shared package.

## Architecture

```
@opencode-ai/spinosa-core/          ← All core logic (25+ modules)
├── commands/                       ← High-level command orchestrators
│   ├── create.ts                   createWorkspace()
│   ├── onboard.ts                  runOnboarding() — scan → batch → tool check → 3-phase import
│   ├── add.ts                      addFiles()
│   ├── startup.ts                  generateStartupPrompt()
│   ├── update.ts                   updateWorkspace()
│   └── upgrade.ts                  upgradeFramework() + checkUpgradeAvailable()
├── import/
│   ├── pipeline.ts                 copySource() — 6-pass copy with runPhase support
│   ├── frontmatter.ts              injectColdFrontmatter()
│   └── batch.ts                    ImportBatchManager
├── extension/
│   ├── classifier.ts               classifySourceFile() — async, 4-tier PDF detection
│   └── pdf.ts                      isTextBasedPdf()
├── workspace/
│   ├── registry.ts                 register/unregister/list workspaces
│   └── meta.ts                     read/write workspace marker, config, health
├── tools/detection.ts             markitdownBin(), rapidocrOcrBin(), detectLlmTools()
├── handoff/
│   ├── builder.ts                  buildLaunchCommand() for 11 CLI types
│   └── runner.ts                   runCliWithPrompt(), copyToClipboard()
├── scan/scanner.ts                scanSource(), detectDocumentTools()
├── framework/discovery.ts         resolveFrameworkRoot()
├── system/channels.ts             Release channel resolution
├── utils/
│   ├── fs.ts                       safeCopy() with retry, safeCopyTree(), cleanMacMetadata()
│   ├── path.ts                     normalizePathInput(), expandHome(), isCloudStoragePath()
│   ├── version.ts                  compareFrameworkVersions()
│   └── string.ts                   formatBytes(), shellQuote()
├── bin/spinosa.ts                  ← NEW: TS CLI entry point
└── test-e2e.ts                     E2E test (17/17 passing)

packages/tui/src/
├── routes/spinosa/
│   ├── onboarding.tsx              New workspace wizard (9 steps)
│   ├── add-files.tsx               Add files wizard
│   ├── workspace-picker.tsx        Workspace list + update
│   └── wizard-ui.tsx               Shared wizard components
├── spinosa/
│   ├── cli-bridge.ts               TUI → core bridge (TS calls, no Bash spawn)
│   ├── service.ts                  Re-exports from spinosa-core
│   ├── onboarding-preview.ts       Scan preview builder (uses core scanner)
│   ├── entry.ts                    Route resolution
│   └── types.ts                    Local types (CliRunResult still here)
```

## Bugs Found (not yet fixed)

### Bug A: `copySource` progress NOT reaching TUI
**Symptom:** The 3-phase `copySource` calls in `runOnboarding` (onboard.ts) return correct results (files ARE copied), but `onCopyProgress` callbacks don't fire during execution. Only the FINAL aggregated result arrives after all phases complete.

**Root cause (suspected):** `runOnboarding` calls `copySource` 3 times in sequence. Each call is `await`ed. The `onProgress` callback from `copySource` updates SolidJS signals in the TUI. But SolidJS batches all updates until the synchronous execution block completes — which is after ALL 3 `copySource` calls finish.

**More specifically:** The `onProgress` callback is `options.onCopyProgress` which is the lambda from cli-bridge.ts. This lambda calls `input?.onCopyProgress?.({...})` which calls `setDirectProg({curr, total, rel})` in the TUI. SolidJS does NOT batch — each setter fires immediately. BUT OpenTUI's render scheduler uses `process.nextTick` which is idempotent — only the FIRST call per sync block schedules a render. Subsequent calls are dropped.

So: `await copySource(...)` returns → `await copySource(...)` runs → all `onProgress` calls fire synchronously → but OpenTUI only renders the FIRST one → the UI shows only the LAST value (or nothing).

**Fix needed:** In `pipeline.ts`, each synchronous loop already has `await yieldToEL()` every 10 files. But the 3 `copySource` calls in `onboard.ts` have NO yield between them. The fix: add `await new Promise(r => setTimeout(r, 0))` BETWEEN the 3 calls:

```typescript
const copyDirect = await copySource(...)
await new Promise(r => setTimeout(r, 0))  // ← MISSING
const copyMd = await copySource(...)
await new Promise(r => setTimeout(r, 0))  // ← MISSING
const copyOcr = await copySource(...)
```

This gives OpenTUI's render scheduler time to flush between phases.

### Bug B: Step advancement message matching
**Status:** Fixed with `.trim()` and `.startsWith()` in `onboarding.tsx:481-490`. No longer an issue.

### Bug C: Progress bars show 0-indexed
**Status:** Fixed — `copyDirectRawFile` now receives `i+1` and shows `[1/67]` not `[0/67]`.

### Bug D: `.json` files fail MarkItDown
`markitdown-ts` v0.0.10 cannot convert JSON files. The pipeline catches this per-file and increments `mdSkipped`. This is acceptable — JSON files aren't really Markdown-convertible. The pipeline continues to the next file.

### Bug E: Startup prompt fallback
**Status:** Fixed — `runOnboarding` now writes generated prompt to `<workspace>/startup-prompt.md`. `finishProvider` reads it back.

## What Worked / Verified

- [x] createWorkspace() — workspace dir, framework copy, sync agents, marker file, manifest, registration
- [x] scanSource() — file classification with async PDF text detection
- [x] copySource() — 6-pass copy with frontmatter injection
- [x] markitdown-ts — replaces Python MarkItDown, pure TS
- [x] verifyAndRecoverImport — full source-tree re-scan, route-aware recovery
- [x] safeCopy with 3 retry, exponential backoff, cloud stream fallback
- [x] resolveBinary() — checks vendor dirs first (markitdownBin, rapidocrOcrBin)
- [x] E2E test: 17/17 passing (file classify, scan, batch, copy, frontmatter, path preservation, media)
- [x] TUI typecheck: 0 errors (1 pre-existing wizard-ui.tsx unrelated)
- [x] spinosa-core typecheck: 0 errors
- [x] CLI: `bun run packages/spinosa-core/bin/spinosa.ts new TEST-VAULT` works

## To Fix Next (Priority Order)

### P0 — Bug A (progress not reaching TUI)
**File:** `packages/spinosa-core/src/commands/onboard.ts`

At line 148-152, add `await new Promise(r => setTimeout(r, 0))` between each `copySource` call:

```typescript
phase("import", "Copying files...")
const copyDirect = await copySource(sourcePath, rawDir, cOpts("direct"))
await new Promise(r => setTimeout(r, 0))           // ← ADD
phase("import", "Converting with MarkItDown...")
const copyMd = await copySource(sourcePath, rawDir, cOpts("markitdown"))
await new Promise(r => setTimeout(r, 0))           // ← ADD
phase("import", "Running OCR...")
const copyOcr = await copySource(sourcePath, rawDir, cOpts("ocr"))
```

This allows OpenTUI's `process.nextTick` render scheduler to flush between phases.

### P1 — `runOnboarding` import/phase flow messages
The `onLog` callbacks from `copySource` (e.g., "Copy complete: 67 total...") should appear in the LogScrollbox via `onPhase("import", msg)`. Currently `onLog` is piped as `(msg) => onPhase?.("import", msg)` which goes to `onStdout`. This should work but double-check the routing.

### P2 — General check
- All 3 progress bars update correctly during their respective phases
- Step advances: setup → direct → markitdown → ocr → provider
- Spinner rotates during processing, stops on completion
- `startup-prompt.md` content is the actual generated prompt (template + workspace metadata)
- E2E test still passes after any changes
