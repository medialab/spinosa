import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { frameworkRootFailureDiagnostics } from "../src/framework/discovery"

describe("framework root discovery diagnostics", () => {
  test("reports the exact source-mode search inputs and why they did not resolve", () => {
    const home = mkdtempSync(path.join(tmpdir(), "spinosa-root-diagnostics-"))
    const cwd = path.join(home, "app")
    try {
      const diagnostics = frameworkRootFailureDiagnostics({
        cwd,
        env: {
          SPINOSA_TEST_HOME: home,
          SPINOSA_DISABLE_VERSION_TREE_DISCOVERY: "true",
        },
      })
      expect(diagnostics).toContain("Framework discovery mode: source/dev")
      expect(diagnostics).toContain(`Working directory: ${cwd} (no expected manifest marker)`)
      expect(diagnostics).toContain("SPINOSA_TEMPLATE_ROOT: <unset>")
      expect(diagnostics).toContain("SPINOSA_FRAMEWORK_ROOT: <unset>")
      expect(diagnostics).toContain(
        `Installed version search: disabled by SPINOSA_DISABLE_VERSION_TREE_DISCOVERY; directory ${path.join(home, ".spinosa", "versions")} (missing); selected <none>`,
      )
      expect(diagnostics).toContain("workspace-template/.spinosa/workspace-files.tsv")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
