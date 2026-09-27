# Tool Conventions — Runtime-Owned Workflows

For routed Spinosa work, the WorkflowEngine and `run.json` are authoritative.
They select runnable nodes, enforce dependencies, apply retries and gates, and
determine terminal state. Agents execute only the supplied workflow node.

A host may provide its own worker-dispatch mechanism, but workers must not
route, dispatch, mint artifact paths, choose the next phase, or reinterpret
gates. The host must supply the node scope, coverage contract, input artifact
paths, and exact output path.

## Runtime loop

1. The router selects a workflow strategy.
2. The engine creates the versioned plan and run control file.
3. Runnable nodes receive bounded prompts and their declared tool policy.
4. The engine validates artifacts, applies retries, and evaluates gates.
5. The run reaches a terminal state only when required nodes and gates pass.

The portable startup prompt is a compatibility fallback for hosts without the
runtime. It must follow the same phase order and completion gates; it is not a
second orchestration design.

## Worker contract

- Read only the supplied scope and input artifacts.
- Use only permitted tools.
- Write only the declared artifact paths.
- Return the artifact path, completion status, and explicit coverage gaps.
- Do not call routing, framing, minting, gating, verification, or evaluator
  controls as part of the worker step.

The coordinator/runtime owns routing, dispatch, artifact naming, gates,
verification, retries, and evaluation.

## Tool boundaries

| Capability | Owner |
|---|---|
| Route and choose strategy | router/runtime |
| Build and schedule workflow nodes | WorkflowEngine |
| Mint paths and enforce artifact contracts | runtime/tools |
| Read, search, and write a bounded artifact | worker |
| Verify claims and apply verification status | verifier/runtime |
| Audit workflow quality | evaluator/runtime |

Legacy `Q1`–`Q5` route labels remain only for migration of old run records. New
instructions and runs use the strategies in `classification.md`.
