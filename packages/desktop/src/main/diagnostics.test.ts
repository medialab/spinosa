import { describe, expect, test } from "bun:test"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import {
  formatDiagnosticErrorChain,
  describeSidecarLaunch,
  desktopServerLogRoots,
  normalizeRendererDiagnostic,
  sanitizeDiagnosticExportData,
  sanitizeDiagnosticExportValue,
  sanitizeDiagnosticText,
  sanitizeDiagnosticValue,
  serializeDiagnosticError,
} from "./diagnostics"

describe("desktop diagnostics", () => {
  test("redacts credentials and prompt-like fields while retaining correlation metadata", () => {
    const home = homedir()
    const privatePath = path.join(home, "Downloads", "private-notes.md")
    const value = sanitizeDiagnosticValue({
      authorization: "Bearer super-secret",
      prompt: "do not log this prompt",
      jobID: "job-123",
      requestID: "req-456",
      durationMs: 42,
      path: privatePath,
    }) as Record<string, unknown>
    expect(value.authorization).toBe("[REDACTED]")
    expect(value.prompt).toBe("[REDACTED]")
    expect(value.jobID).toBe("job-123")
    expect(value.requestID).toBe("req-456")
    expect(value.durationMs).toBe(42)
    const exported = sanitizeDiagnosticExportValue(value) as Record<
      string,
      unknown
    >
    expect(exported.path).toBe("$PATH")
  })

  test("preserves nested error causes and stacks", () => {
    const error = new Error("outer failure", {
      cause: new Error("inner failure"),
    })
    const serialized = serializeDiagnosticError(error) as {
      cause?: { message?: string }
      stack?: string
    }
    expect(serialized.stack).toContain("outer failure")
    expect(serialized.cause?.message).toBe("inner failure")
    expect(formatDiagnosticErrorChain(error)).toContain("Caused by:")
  })

  test("validates renderer diagnostics at the IPC boundary", () => {
    const diagnostic = normalizeRendererDiagnostic({
      event: "onboarding.job.state",
      level: "error",
      correlationID: "req-1",
      durationMs: 12.6,
      fields: {
        authorization: "Basic secret",
        jobID: "job-1",
        prompt: "private",
      },
    })
    expect(diagnostic).toMatchObject({
      event: "onboarding.job.state",
      level: "error",
      correlationID: "req-1",
      durationMs: 13,
    })
    expect(diagnostic?.fields?.authorization).toBe("[REDACTED]")
    expect(diagnostic?.fields?.prompt).toBe("[REDACTED]")
    expect(
      normalizeRendererDiagnostic({ event: "bad event", fields: {} }),
    ).toBeUndefined()
    expect(
      normalizeRendererDiagnostic({
        event: "safe",
        correlationID: "../not-an-id",
      })?.correlationID,
    ).toBeUndefined()
  })

  test("scrubs secrets and user paths from text exports without changing binary entries", () => {
    const text = sanitizeDiagnosticText(
      `token=secret Authorization: Bearer abcdefghijklmnop ${path.join(tmpdir(), "private", "note.md")}`,
    )
    expect(text).toContain("token=[REDACTED]")
    expect(text).toContain("Bearer [REDACTED]")
    const exported = sanitizeDiagnosticExportData(
      "diagnostic.ndjson",
      Buffer.from(
        `cwd=${path.join(homedir(), "Downloads", "private", "note.md")} token=secret`,
      ),
    ).toString("utf8")
    expect(exported).not.toContain("private")
    expect(exported).not.toContain("secret")
    const binary = Buffer.from([0, 1, 2, 3])
    expect(sanitizeDiagnosticExportData("network.bin", binary)).toEqual(binary)
  })

  test("keeps product logs in the debug export without dropping legacy roots", () => {
    const roots = desktopServerLogRoots({
      userDataPath: "/userData",
      xdgDataHome: "/xdg",
      productHome: "/product",
    })
    expect(roots).toContain("/product/logs")
    expect(roots).toContain("/xdg/opencode/log")
    expect(roots).toContain("/userData/opencode/log")
  })

  test("describes packaged and development sidecar launch inputs", () => {
    const launch = describeSidecarLaunch({
      launchID: "launch-1",
      packaged: false,
      cwd: tmpdir(),
      appPath: tmpdir(),
      resourcesPath: "/resources",
      userDataPath: tmpdir(),
      bunBin: "bun",
      bunSource: "path",
      sidecarScript: "/app/serve-bun-sidecar.ts",
      env: { SPINOSA_TEMPLATE_ROOT: "/framework" },
      developmentRoot: "/framework",
    })
    expect(launch.runtime).toBe("development")
    expect(launch.packaged).toBe(false)
    expect(launch.launchID).toBe("launch-1")
    expect(launch.bun.source).toBe("path")
    expect(launch.framework.templateRoot).toBe("/framework")
  })
})
