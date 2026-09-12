# Skills Reference

| Role | Native Agent | Skill | What it does |
|---|---|---|---|
| Searcher | `spinosa-searcher` | `spinosa-searcher` | Searches existing raw copies and maps for evidence |
| Analyst | `spinosa-analyst` | `spinosa-analyst` | Reads prior artifacts and project context, then writes a contextual analysis packet |
| Writer | `spinosa-writer` | `spinosa-writer` | Produces the user-facing answer report when the run requires one |
| Verifier | `spinosa-verifier` | `spinosa-verifier` | Truth-checks claims, quotes, and paths in substantive artifacts |
| Evaluator | `spinosa-evaluator` | `spinosa-evaluator` | Audits completed runs and decides whether evolution is justified |
| Evolver | `spinosa-evolver` | `spinosa-evolver` | Applies tightly scoped framework updates for future requests (never TypeScript workflow definitions) |
| Janitor | `spinosa-janitor` | `spinosa-janitor` | Writes a cleanup audit artifact and proposes archival moves |
| Mapper | `spinosa-mapper` | `spinosa-mapper` | Reads raw files in batches; extracts content-grounded fragments, key passages, and concept signals; writes maps |
| Serendippo | `spinosa-serendippo` | `spinosa-serendippo` | Finds hidden cross-corpus connections and proposes map enrichment |
| Overseer | `spinosa-overseer` | `spinosa-overseer` | Coverage/retrospective audit after `workspace_started`; never during startup |
| Visualizer | `spinosa-writer` | `spinosa-writer` | Renders pure-Unicode charts in markdown when a run requests visualization |
| Router | `spinosa-router` | `spinosa-router` | Hidden intent router; returns a RouteDecision only |
