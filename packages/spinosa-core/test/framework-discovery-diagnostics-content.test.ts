import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { frameworkRootFailureDiagnostics } from "../src/framework/discovery"

describe("framework discovery diagnostic content", () => {
  test("reports ancestor launch inputs, version candidates, and cache state", () => {
    const home = mkdtempSync(path.join(tmpdir(), "spinosa-root-content-"))
    const productHome = path.join(home, ".spinosa")
    const versionRoot = path.join(
      productHome,
      "versions",
      "1.2.3",
      "spinosa-framework-1.2.3",
    )
    const marker = path.join(
      versionRoot,
      "workspace-template",
      ".spinosa",
      "workspace-files.tsv",
    )
    const cacheRoot = path.join(productHome, "templates", "dev")
    mkdirSync(path.dirname(marker), { recursive: true })
    writeFileSync(marker, "")
    mkdirSync(path.join(cacheRoot, ".spinosa"), { recursive: true })
    writeFileSync(
      path.join(cacheRoot, ".spinosa", "template-pack.json"),
      JSON.stringify({ version: "dev", packId: "pack-1", files: [] }),
    )
    writeFileSync(
      path.join(cacheRoot, ".spinosa", ".pack-complete"),
      "pack-1\n",
    )

    try {
      const diagnostics = frameworkRootFailureDiagnostics({
        cwd: path.join(home, "app"),
        env: {
          SPINOSA_TEST_HOME: home,
          SPINOSA_HOME: productHome,
          SPINOSA_DESKTOP_PACKAGED: "false",
          SPINOSA_DESKTOP_DEVELOPMENT_ROOT: path.join(home, "framework"),
          SPINOSA_DESKTOP_APP_PATH: path.join(home, "app"),
          SPINOSA_DESKTOP_RESOURCES_PATH: path.join(home, "resources"),
          SPINOSA_DESKTOP_SIDECAR_SCRIPT: path.join(
            home,
            "serve-bun-sidecar.ts",
          ),
        },
      })
      expect(diagnostics).toContain("Desktop packaged: false")
      expect(diagnostics).toContain("Development framework search: /")
      expect(diagnostics).toContain("App path: /")
      expect(diagnostics).toContain("Resources path: /")
      expect(diagnostics).toContain("Sidecar script: /")
      expect(diagnostics).toContain("version 1.2.3")
      expect(diagnostics).toContain("candidate 1.2.3/spinosa-framework-1.2.3")
      expect(diagnostics).toContain("selected")
      expect(diagnostics).toContain("completionMarker=present")
      expect(diagnostics).toContain("packId=pack-1")
      expect(diagnostics).toContain("complete=true")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
