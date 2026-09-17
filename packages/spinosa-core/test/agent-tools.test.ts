// Agent-tools core: deterministic aids behind the spinosa_* kernel tools.
// Pure logic plus tmp-workspace round-trips (goal framing, verification).
import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  spinosaFrame,
  spinosaGate,
  spinosaMintPaths,
  spinosaRoute,
  spinosaVerify,
} from "../src/application/agent-tools"

async function workspace(status = "workspace_started"): Promise<string> {
  const root = path.join(tmpdir(), "spinosa-agtools-" + crypto.randomUUID())
  await mkdir(path.join(root, ".spinosa"), { recursive: true })
  await mkdir(path.join(root, "agent_reports"), { recursive: true })
  await Bun.write(path.join(root, ".spinosa", "workspace"), `setup_status: ${status}\n`)
  return root
}

const WS = { isSpinosa: true, setupStatus: "workspace_started" as const }

describe("spinosaRoute", () => {
  test("explicit agent selection routes general via rules", () => {
    const routed = spinosaRoute({ text: "research everything", ...WS, explicitAgent: "build" })
    expect(routed.decision).toEqual({ mode: "general" })
    expect(routed.via).toBe("rules")
    expect(routed.provisional).toBe(false)
  })

  test("startup command routes orchestrated corpus.startup_index via rules", () => {
    const routed = spinosaRoute({ text: "anything", ...WS, command: "startup" })
    expect(routed.decision).toMatchObject({ mode: "orchestrated", operation: "corpus", strategy: "startup_index" })
    expect(routed.provisional).toBe(false)
  })

  test("ambiguous input falls back provisional so the model can override", () => {
    const routed = spinosaRoute({ text: "What does the corpus say about onboarding?", ...WS })
    expect(routed.via).toBe("heuristic")
    expect(routed.provisional).toBe(true)
    expect(routed.decision.mode).toBe("orchestrated")
  })

  test("non-Spinosa workspace routes general", () => {
    const routed = spinosaRoute({ text: "Who mentions X? Full census.", isSpinosa: false, setupStatus: "unknown" })
    expect(routed.decision).toEqual({ mode: "general" })
  })
})

describe("spinosaFrame", () => {
  test("frames an orchestrated decision with goal artifact", async () => {
    const root = await workspace()
    const framed = await spinosaFrame({
      workspacePath: root,
      cleanedPrompt: "Find source-grounded evidence for interviews",
      decision: {
        mode: "orchestrated", operation: "research", strategy: "targeted_evidence",
        scope: "subset", coverage: "sufficient", outputs: ["report"],
        mutation: "none", verification: "normal", evaluation: "always",
        reason: "test", confidence: 0.8,
      },
    })
    if (!framed.ok) throw new Error(`expected frame: ${framed.reason}`)
    expect(framed.runID).toMatch(/^\d{8}-[0-9a-f]+$/)
    expect(await Bun.file(path.join(root, framed.goalPath)).exists()).toBe(true)
  })

  test("refuses outside Spinosa workspaces", async () => {
    const framed = await spinosaFrame({
      workspacePath: tmpdir(),
      cleanedPrompt: "hi",
      decision: {
        mode: "orchestrated", operation: "research", strategy: "targeted_evidence",
        scope: "subset", coverage: "sufficient", outputs: ["report"],
        mutation: "none", verification: "normal", evaluation: "always",
        reason: "test", confidence: 0.8,
      },
    })
    expect(framed.ok).toBe(false)
  })
})

describe("spinosaMintPaths", () => {
  test("mints every kind by convention", () => {
    const minted = spinosaMintPaths({
      runID: "20260915-abc123",
      kinds: ["goal", "evidence", "evidence_appendix", "analysis", "serendipity", "verification", "evaluation", "coverage", "map", "cleanup"],
    })
    if (!minted.ok) throw new Error(minted.reason)
    expect(minted.paths.goal).toBe("agent_reports/g_20260915-abc123.md")
    expect(minted.paths.evidence).toBe("agent_reports/evidence_packet_20260915-abc123.md")
    expect(minted.paths.evaluation).toBe("agent_reports/e_20260915-abc123.md")
    expect(minted.paths.coverage).toBe("agent_reports/c_20260915-abc123.md")
  })

  test("branch slugs fan evidence and extraction paths out", () => {
    const minted = spinosaMintPaths({ runID: "20260915-abc123", kinds: ["evidence", "extraction"], branch: "fisheries-policy" })
    if (!minted.ok) throw new Error(minted.reason)
    expect(minted.paths.evidence).toBe("agent_reports/evidence_packet_20260915-abc123_fisheries-policy.md")
    expect(minted.paths.extraction).toBe("agent_reports/extraction_fisheries-policy.md")
  })

  test("reports need number and slug; bad runIDs rejected", () => {
    expect(spinosaMintPaths({ runID: "20260915-abc123", kinds: ["report"] }).ok).toBe(false)
    expect(spinosaMintPaths({ runID: "nope", kinds: ["goal"] }).ok).toBe(false)
    const minted = spinosaMintPaths({ runID: "20260915-abc123", kinds: ["report"], reportNumber: "04", reportSlug: "cohort-views" })
    if (!minted.ok) throw new Error(minted.reason)
    expect(minted.paths.report).toBe("agent_reports/04_cohort-views.md")
  })
})

describe("spinosaGate", () => {
  test("opportunistic needs one source", () => {
    expect(spinosaGate({ coverage: "opportunistic", sourceCount: 1 }).pass).toBe(true)
    expect(spinosaGate({ coverage: "opportunistic", sourceCount: 0 }).pass).toBe(false)
  })

  test("representative and exhaustive check denominators", () => {
    expect(spinosaGate({ coverage: "representative", sourceCount: 3, strataCovered: 2, strataTotal: 3 }).pass).toBe(false)
    expect(spinosaGate({ coverage: "representative", sourceCount: 3, strataCovered: 3, strataTotal: 3 }).pass).toBe(true)
    expect(spinosaGate({ coverage: "exhaustive", sourceCount: 9, partitionsAccounted: 9, partitionsTotal: 9 }).pass).toBe(true)
  })
})

describe("spinosaVerify", () => {
  test("missing artifacts fail retryable", async () => {
    const root = await workspace()
    const checked = await spinosaVerify({ workspacePath: root, relativePath: "agent_reports/nope.md", validator: "report" })
    expect(checked.ok).toBe(false)
    if (checked.ok) throw new Error("expected failure")
    expect(checked.retryable).toBe(true)
  })

  test("report without title fails; titled report passes", async () => {
    const root = await workspace()
    await Bun.write(path.join(root, "agent_reports/01_x.md"), "no title here\n")
    const bad = await spinosaVerify({ workspacePath: root, relativePath: "agent_reports/01_x.md", validator: "report" })
    expect(bad.ok).toBe(false)
    await Bun.write(path.join(root, "agent_reports/02_x.md"), "# Titled\n\nBody.\n")
    const good = await spinosaVerify({ workspacePath: root, relativePath: "agent_reports/02_x.md", validator: "report" })
    expect(good).toMatchObject({ ok: true, status: "pass", action: "complete" })
  })

  test("verification status maps to actions", async () => {
    const root = await workspace()
    await Bun.write(path.join(root, "agent_reports/v.md"), "---\nstatus: partial\n---\n\n# V\n\nNotes.\n")
    const checked = await spinosaVerify({ workspacePath: root, relativePath: "agent_reports/v.md", validator: "verification" })
    expect(checked).toMatchObject({ ok: true, status: "partial", action: "retry" })
  })

  test("paths escaping the workspace are refused", async () => {
    const root = await workspace()
    const checked = await spinosaVerify({ workspacePath: root, relativePath: "../../etc/passwd", validator: "report" })
    expect(checked.ok).toBe(false)
  })
})
