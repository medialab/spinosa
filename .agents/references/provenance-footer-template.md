# Evidence and Coverage Note

Use this optional section only when the runtime supplies a search or evidence
artifact with these details. The report node writes it as part of its declared
report artifact; workers and evaluators do not append or invent provenance.

```markdown
## Evidence and Coverage

- **Query:** [runtime-supplied query]
- **Coverage contract:** opportunistic | sufficient | representative | exhaustive
- **Searched scope:** [sources, files, or strata actually inspected]
- **Unsearched scope:** [known remaining scope, or `none` when established]
- **Search interface and terms:** [host interface and recorded search terms]
- **Truncation:** [whether results were truncated and how that was handled]
- **Blockers:** [access or parsing constraints, or `none`]
- **Sources cited:** [source paths and locations]
```

Omit fields the supplied artifacts do not establish. Preserve explicit unknowns;
do not turn an unreported scope into `none`, infer corpus totals, or treat a
search with no results as proof that a concept is absent.
