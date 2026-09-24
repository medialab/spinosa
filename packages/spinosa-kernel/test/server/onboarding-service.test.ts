import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  cancelOnboardingScan,
  getOnboardingJob,
  getOnboardingScanProgress,
  previewOnboarding,
  startOnboardingJob,
} from "../../src/server/routes/instance/httpapi/onboarding-service"

describe("desktop onboarding scan service", () => {
  test("returns scan results and scopes progress to the primary source", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-onboarding-preview-"))
    const source = path.join(root, "source")
    mkdirSync(source)
    writeFileSync(path.join(source, "notes.md"), "# Notes\n")
    const scanID = crypto.randomUUID()

    try {
      const result = await previewOnboarding([source], scanID)
      expect(result.sources[0]?.counts.native).toBe(1)
      expect(getOnboardingScanProgress(scanID, source)?.status).toBe("completed")
      expect(getOnboardingScanProgress(scanID, root)).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("cancels a scan and retains its resumable progress state", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-onboarding-cancel-"))
    const source = path.join(root, "source")
    mkdirSync(source)
    for (let index = 0; index < 100; index++) {
      writeFileSync(path.join(source, `note-${index}.md`), `# Note ${index}\n`)
    }
    const scanID = crypto.randomUUID()

    try {
      const pending = previewOnboarding([source], scanID)
      expect(cancelOnboardingScan(scanID, source)?.status).toBe("cancelled")
      await expect(pending).rejects.toThrow("Source scan cancelled")
      expect(getOnboardingScanProgress(scanID, source)?.status).toBe("cancelled")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("records framework discovery evidence when workspace creation cannot resolve the template", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "spinosa-onboarding-root-failure-"))
    const source = path.join(root, "source")
    const previousCwd = process.cwd()
    const envKeys = ["SPINOSA_TEMPLATE_ROOT", "SPINOSA_FRAMEWORK_ROOT", "SPINOSA_DISABLE_VERSION_TREE_DISCOVERY", "SPINOSA_HOME"]
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
    mkdirSync(source)

    try {
      process.chdir(source)
      const runningCwd = process.cwd()
      process.env.SPINOSA_TEMPLATE_ROOT = path.join(root, "missing-template")
      delete process.env.SPINOSA_FRAMEWORK_ROOT
      process.env.SPINOSA_DISABLE_VERSION_TREE_DISCOVERY = "true"
      process.env.SPINOSA_HOME = path.join(root, "home")

      const started = await startOnboardingJob({
        sourcePaths: [source],
        workspaceName: "root-failure-test",
        extensions: ["md"],
        visionModelId: "none",
        preferredCli: "opencode",
      }, source, async () => "")
      const job = getOnboardingJob(started.id, source)

       expect(job?.status).toBe("failed")
       expect(job?.error).toBe("Spinosa framework root not found.")
       const logs = job?.logs.join("\n") ?? ""
       expect(logs).toContain("Working directory: $PATH (no expected manifest marker)")
       expect(logs).not.toContain(runningCwd)
       expect(logs).toContain("SPINOSA_TEMPLATE_ROOT: $PATH (no expected manifest marker)")
       expect(logs).not.toContain(path.join(root, "missing-template"))
       expect(logs).toContain("Installed version search: disabled by SPINOSA_DISABLE_VERSION_TREE_DISCOVERY")
       expect(logs).toContain("Error: Spinosa framework root not found.")
       expect(logs).toContain("Caused by:")
       const bootLogText = readFileSync(path.join(root, "home", "logs", "boot.tui.ndjson"), "utf8")
       expect(bootLogText).toContain("onboarding.framework.failure")
       expect(bootLogText).toContain("requestID")
       expect(bootLogText).toContain("Caused by:")
       expect(bootLogText).not.toContain(root)

    } finally {
      process.chdir(previousCwd)
      for (const key of envKeys) {
        const value = previousEnv[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      rmSync(root, { recursive: true, force: true })
    }
  })
})
