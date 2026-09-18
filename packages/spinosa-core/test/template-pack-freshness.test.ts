import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  extractStartupPromptWorkspaceSuffix,
  inspectTemplatePackFreshness,
  mergeStartupPromptTemplate,
  stripStartupPromptWorkspaceSuffix,
  workspaceVersionAheadOfBundled,
  workspaceVersionBehindBundled,
} from "../src/framework/template-pack-freshness"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const templateRoot = path.join(repoRoot, "workspace-template")

describe("template pack freshness", () => {
  test("strips and restores startup-prompt workspace footer", () => {
    const template = "# Index\n\nHard ban during startup\n"
    const existing = `${template}\n## Workspace Metadata\n\n- **Project title:** Demo\n`
    expect(stripStartupPromptWorkspaceSuffix(existing)).toBe(template)
    expect(extractStartupPromptWorkspaceSuffix(existing)).toContain("## Workspace Metadata")
    const merged = mergeStartupPromptTemplate("# Index\n\nUpdated protocol\n", existing)
    expect(merged).toContain("Updated protocol")
    expect(merged).toContain("## Workspace Metadata")
    expect(merged).toContain("Demo")
  })

  test("version behind detection", () => {
    expect(workspaceVersionBehindBundled("1.0.3-beta.11", "1.0.3-beta.12")).toBe(true)
    expect(workspaceVersionBehindBundled("1.0.3-beta.12", "1.0.3-beta.12")).toBe(false)
    expect(workspaceVersionBehindBundled("dev", "1.0.3-beta.12")).toBe(true)
  })

  test("version ahead detection", () => {
    expect(workspaceVersionAheadOfBundled("1.0.3-beta.13", "1.0.3-beta.12")).toBe(true)
    expect(workspaceVersionAheadOfBundled("1.0.3-beta.12", "1.0.3-beta.12")).toBe(false)
    expect(workspaceVersionAheadOfBundled("dev", "1.0.3-beta.12")).toBe(false)
  })

  test("marks a newer workspace as stale so Update workspace can align down", () => {
    const freshness = inspectTemplatePackFreshness({
      workspacePath: repoRoot,
      workspaceVersion: "1.2.0-beta.9",
      bundledVersion: "1.2.0-beta.8",
    })
    expect(freshness.versionAhead).toBe(true)
    expect(freshness.versionBehind).toBe(false)
    expect(freshness.stale).toBe(true)
    expect(freshness.refreshRecommended).toBe(true)
    expect(freshness.message).toContain("newer than this Spinosa install")
  })

  test("detects stale protocol even when framework versions match", () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-pack-fresh-"))
    try {
      mkdirSync(path.join(root, ".agents", "references"), { recursive: true })
      mkdirSync(path.join(root, ".agents", "agents"), { recursive: true })
      mkdirSync(path.join(root, ".agents", "skills", "spinosa-overseer"), { recursive: true })
      writeFileSync(
        path.join(root, "startup-prompt.md"),
        [
          "# Index This Workspace",
          "",
          "Maps → writer/analyst",
          "extraction_batch_001.md",
          "serendipity_report.md",
          "",
          "## Workspace Metadata",
          "",
          "- **Project title:** Demo",
          "",
        ].join("\n"),
      )
      writeFileSync(path.join(root, "AGENTS.md"), "old agents contract\n")
      writeFileSync(path.join(root, ".agents", "references", "classification.md"), "old classification\n")
      writeFileSync(path.join(root, ".agents", "agents", "spinosa-overseer.md"), "old overseer\n")
      writeFileSync(path.join(root, ".agents", "skills", "spinosa-overseer", "SKILL.md"), "old skill\n")

      const freshness = inspectTemplatePackFreshness({
        workspacePath: root,
        templateRoot,
        workspaceVersion: "1.0.3-beta.12",
        bundledVersion: "1.0.3-beta.12",
      })
      expect(freshness.versionBehind).toBe(false)
      expect(freshness.protocolBehind).toBe(true)
      expect(freshness.stale).toBe(true)
      expect(freshness.refreshRecommended).toBe(true)
      expect(freshness.stalePaths).toContain("startup-prompt.md")
      expect(freshness.message).toContain("stale")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("marks current protocol pack as fresh", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-pack-current-"))
    try {
      mkdirSync(path.join(root, ".agents", "references"), { recursive: true })
      mkdirSync(path.join(root, ".agents", "agents"), { recursive: true })
      mkdirSync(path.join(root, ".agents", "skills", "spinosa-overseer"), { recursive: true })
      for (const relative of [
        "startup-prompt.md",
        "AGENTS.md",
        ".agents/references/classification.md",
        ".agents/agents/spinosa-overseer.md",
        ".agents/skills/spinosa-overseer/SKILL.md",
      ]) {
        mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
        writeFileSync(path.join(root, relative), await Bun.file(path.join(templateRoot, relative)).text())
      }
      // Mimic onboarding footer without changing protocol body.
      const startup = await Bun.file(path.join(root, "startup-prompt.md")).text()
      writeFileSync(
        path.join(root, "startup-prompt.md"),
        `${stripStartupPromptWorkspaceSuffix(startup).trimEnd()}\n\n## Workspace Metadata\n\n- **Project title:** Demo\n`,
      )
      writeFileSync(
        path.join(root, "AGENTS.md"),
        (await Bun.file(path.join(templateRoot, "AGENTS.md")).text()).replaceAll(
          "{{WORKSPACE_PATH}}",
          root,
        ),
      )

      const freshness = inspectTemplatePackFreshness({
        workspacePath: root,
        templateRoot,
        workspaceVersion: "1.0.3-beta.12",
        bundledVersion: "1.0.3-beta.12",
      })
      expect(freshness.stale).toBe(false)
      expect(freshness.protocolBehind).toBe(false)
      expect(freshness.stalePaths).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
