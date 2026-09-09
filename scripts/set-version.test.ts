import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertChangelogHasVersion,
  changelogHasVersionSection,
  syncProductVersion,
  PRODUCT_PACKAGE_DIRS,
} from "./set-version.ts"

describe("changelog version section", () => {
  test("matches Keep a Changelog headings", () => {
    const md = `# Changelog\n\n## [1.0.3-beta.1] — 2026-07-30\n\n### Changed\n\n- note\n`
    expect(changelogHasVersionSection(md, "1.0.3-beta.1")).toBe(true)
    expect(changelogHasVersionSection(md, "1.0.3-beta.2")).toBe(false)
  })

  test("assertChangelogHasVersion fails loud when missing", () => {
    const root = mkdtempSync(join(tmpdir(), "spinosa-set-version-"))
    try {
      writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## [1.0.0] - 2026-01-01\n")
      expect(() => assertChangelogHasVersion(root, "1.0.3-beta.1")).toThrow(/CHANGELOG.md missing section/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("syncProductVersion", () => {
  test("syncs root, install.sh, and product packages; leaves fork packages alone", () => {
    const root = mkdtempSync(join(tmpdir(), "spinosa-set-version-"))
    try {
      writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "spinosa", version: "1.0.2-beta.2" }, null, 2)}\n`)
      writeFileSync(join(root, "install.sh"), `#!/bin/sh\nPINNED_VERSION="1.0.2-beta.2"\nPINNED_TAG="beta"\n`)
      writeFileSync(
        join(root, "CHANGELOG.md"),
        `# Changelog\n\n## [1.0.3-beta.1] — 2026-07-30\n\n### Changed\n\n- audit\n`,
      )

      for (const dir of PRODUCT_PACKAGE_DIRS) {
        mkdirSync(join(root, dir), { recursive: true })
        writeFileSync(
          join(root, dir, "package.json"),
          `${JSON.stringify({ name: `@spinosa/${dir.split("/").at(-1)}`, version: "1.0.2-beta.2" }, null, 2)}\n`,
        )
      }

      mkdirSync(join(root, "packages/spinosa-kernel"), { recursive: true })
      writeFileSync(
        join(root, "packages/spinosa-kernel/package.json"),
        `${JSON.stringify({ name: "@spinosa/kernel", version: "1.17.12" }, null, 2)}\n`,
      )
      mkdirSync(join(root, "packages/tui"), { recursive: true })
      writeFileSync(
        join(root, "packages/tui/package.json"),
        `${JSON.stringify({ name: "@spinosa/tui", version: "1.17.12" }, null, 2)}\n`,
      )

      const result = syncProductVersion("1.0.3-beta.1", root)
      expect(result.previous).toBe("1.0.2-beta.2")
      expect(result.syncedPackages).toEqual([...PRODUCT_PACKAGE_DIRS])

      const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string }
      expect(rootPkg.version).toBe("1.0.3-beta.1")
      expect(readFileSync(join(root, "install.sh"), "utf-8")).toContain(`PINNED_VERSION="1.0.3-beta.1"`)

      for (const dir of PRODUCT_PACKAGE_DIRS) {
        const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf-8")) as { version: string }
        expect(pkg.version).toBe("1.0.3-beta.1")
      }

      const kernel = JSON.parse(readFileSync(join(root, "packages/spinosa-kernel/package.json"), "utf-8")) as { version: string }
      const tui = JSON.parse(readFileSync(join(root, "packages/tui/package.json"), "utf-8")) as { version: string }
      expect(kernel.version).toBe("1.17.12")
      expect(tui.version).toBe("1.17.12")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("refuses to sync when CHANGELOG section is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "spinosa-set-version-"))
    try {
      writeFileSync(join(root, "package.json"), `${JSON.stringify({ version: "1.0.2-beta.2" }, null, 2)}\n`)
      writeFileSync(join(root, "install.sh"), `PINNED_VERSION="1.0.2-beta.2"\n`)
      writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n")
      expect(() => syncProductVersion("1.0.3-beta.1", root)).toThrow(/CHANGELOG.md missing section/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
