// WP9: classification documentation is generated from code — the template
// file must embed the exact registry table so TS and Markdown cannot drift.
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { renderWorkflowTable, BUILTIN_WORKFLOWS } from "../src"

const classificationPath = path.resolve(
  import.meta.dir, "..", "..", "..", "workspace-template", ".agents", "references", "classification.md",
)

describe("generated classification docs", () => {
  test("template embeds the exact registry table", async () => {
    const file = Bun.file(classificationPath)
    expect(await file.exists()).toBe(true)
    const text = await file.text()
    for (const def of BUILTIN_WORKFLOWS) {
      if (def.id === "corpus.maintenance") continue // reserved grammar, undocumented
      expect(text).toContain(`\`${def.id}\``)
      expect(text).toContain(`v${def.version}`)
    }
    // The full rendered table (minus its own title block) is embedded verbatim.
    const table = renderWorkflowTable().split("\n").filter((l) => l.startsWith("|")).join("\n")
    expect(text).toContain(table)
  })
})
