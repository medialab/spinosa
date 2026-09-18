# How to pick a plan (generated — do not hand-edit)

Source of truth: `packages/spinosa-runtime/src/workflows/`.

Pass `strategy` as one short name. Copy it from `spinosa_route`.
Do not write a sentence. Do not write a chain like `search -> write`.

| If they want | strategy | Plan |
| ------------- | -------- | ---- |
| Quotes and sources for one question | `targeted_evidence` | Find evidence (`research.targeted_evidence` v1) |
| A synthesis or cohort reading | `contextual_synthesis` | Put it in context (`research.contextual_synthesis` v1) |
| A complete count or census | `corpus_census` | Count across the corpus (`research.corpus_census` v1) |
| A comparison across sources | `comparative_synthesis` | Compare sources (`research.comparative_synthesis` v1) |
| To test a claim against the corpus | `hypothesis_test` | Test a hypothesis (`research.hypothesis_test` v1) |
| Patterns nobody asked for by name | `exploratory_discovery` | Look for hidden connections (`research.exploratory_discovery` v1) |
| First-time indexing | `startup_index` | Index the workspace (`corpus.startup_index` v1) |
| To bring in new files | `add_sources` | Add sources (`corpus.add_sources` v1) |
| A cleanup proposal | `cleanup_proposal` | Propose cleanup (`maintenance.cleanup_proposal` v1) |
| To apply an approved cleanup | `cleanup_apply` | Apply cleanup (`maintenance.cleanup_apply` v1) |
| A coverage check | `coverage_audit` | Check coverage (`meta.coverage_audit` v1) |
| A tightly scoped framework edit | `framework_evolution` | Update the framework (`meta.framework_evolution` v1) |

## Notes

- Index the workspace (`startup_index`) while setup is `cli_started`, or when the user asks to index. Never dispatch `spinosa-overseer` then.
- Check coverage (`coverage_audit`) only after `workspace_started`.
- Cleanup never moves files until the user approves.
- Analyst organizes evidence the Searcher already found. Serendippo looks in `raw/` for links Searcher missed.
