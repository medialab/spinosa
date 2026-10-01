#!/usr/bin/env bun

import { writeFile } from "node:fs/promises"
import path from "node:path"
import { renderWorkflowTable } from "../packages/spinosa-runtime/src/documentation"

const root = path.resolve(import.meta.dir, "..")

export const WORKFLOW_CLASSIFICATION_PATHS = [
  ".agents/references/classification.md",
  "workspace-template/.agents/references/classification.md",
] as const

const content = renderWorkflowTable()
for (const relativePath of WORKFLOW_CLASSIFICATION_PATHS) {
  await writeFile(path.join(root, relativePath), content)
}

console.log(`synced ${WORKFLOW_CLASSIFICATION_PATHS.length} workflow classification files`)
