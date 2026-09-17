# Audit Fixes — Spinosa monorepo (v1.0.3-beta.13)

Branch: `audit/fixes-beta13` · Target: fix all confirmed findings (blocks A–H)

## Status

- [x] **Block A — core hardening** (`5f442f3d`)
      update/upgrade safety, workspace names, yaml, release channels
- [x] **Block B — server security** (`1ede5bbe`)
      CORS hostile-localhost hole, sync/directory access scoping
- [x] **Block C — import pipeline** (`3ee0555b`)
      E2BIG-safe worker payloads, OCR page wedges, case-safe rel paths
- [x] **Block D — TUI stability** (`ba023a1b`)
      don't kill running sessions on switch, unstick boot overlay, SSE rehydration
- [x] **Block E — kernel delivery** (`09dcb31a`)
      default prompts to queue delivery, restrict task permission bypass
- [x] **Block F — docs/README reconciliation** (`7afc1797`)
      live beta install URLs (stable/v1.0.3 404), drop unimplemented
      SPINOSA_NO_EMOJI, fix agent count (11, not 10), website /install redirect
- [ ] **Block G — ???** (not started)
- [ ] **Block H — ???** (not started)

## Verified non-issues (no change needed)

- Upgrade flags docs match CLI (`--channel stable|beta`, `--yes`, `--reinstall`,
  `--allow-downgrade`, `--check`, `--version`/positional)
- README formats list matches converters
- Wizard is 11 steps (`totalSteps = 11`)
- `auto_upgrade` / `beta` config keys exist in code
- Website primary install commands already used beta URL

## Open items

- Re-run kernel + TUI suites after Block E to reassess remaining failures
  (baseline: kernel 18 fail + 1 error / 2936, TUI 54 fail / 574 — mostly
  pre-existing flakes, snapshots, network tests)
- `packages/spinosa-kernel/src/generated/template-pack.gen.ts` — pre-existing
  dirty file (beta.13 version bump), deliberately left uncommitted
