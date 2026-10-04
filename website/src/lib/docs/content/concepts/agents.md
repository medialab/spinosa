# Agents and Workflows

Spinosa can answer a bounded request directly or run a workflow when it needs source evidence, analysis, or a durable report. The runtime chooses the steps for each request. There is no fixed agent chain, and not every request runs every role.

## Agent roles

| Role           | What it does                                                        |
| -------------- | ------------------------------------------------------------------- |
| **Mapper**     | Extracts information from the corpus and maintains navigation maps. |
| **Searcher**   | Finds passages in imported sources and records evidence.            |
| **Analyst**    | Adds context and identifies gaps in the supplied evidence.          |
| **Serendippo** | Looks for supported connections across sources.                     |
| **Writer**     | Produces a readable report when the workflow needs one.             |
| **Verifier**   | Checks claims, quotations, and citations against sources.           |
| **Evaluator**  | Audits a completed workflow.                                        |
| **Evolver**    | Applies an approved, scoped update to workspace guidance.           |
| **Janitor**    | Audits workspace hygiene and proposes cleanup.                      |
| **Overseer**   | Audits evidence coverage when scheduled by a workflow.              |

## How to use the results

Reports and other durable outputs are saved in `agent_reports/`. Read the cited passages in `raw/` and check any limitations. A verification status describes the checks that ran; it does not guarantee that the answer is complete or correct.

For simple questions, ask directly. For research tasks, name the groups, time period, or source coverage you want and ask for quotations and file paths. See [Reports](/docs/reports) for status meanings and [Workspace Structure](/docs/workspace) for file locations.
