import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  extractionPathFor,
  formatExtractionMarkdown,
  isUsableBatchId,
  spinosaMap,
} from "../src/application/spinosa-map"

async function workspace(): Promise<string> {
  const root = path.join(tmpdir(), "spinosa-map-" + crypto.randomUUID())
  await mkdir(path.join(root, ".spinosa"), { recursive: true })
  await mkdir(path.join(root, "agent_reports"), { recursive: true })
  await mkdir(path.join(root, "maps"), { recursive: true })
  await mkdir(path.join(root, "raw"), { recursive: true })
  await Bun.write(path.join(root, ".spinosa", "workspace"), "setup_status: workspace_started\n")
  await Bun.write(path.join(root, "raw", "interview.md"), "# Interview\n\nCoastal relocation notes.\n")
  return root
}

describe("spinosaMap helpers", () => {
  test("rejects bare batch ids", () => {
    expect(isUsableBatchId("batch_001")).toBe(false)
    expect(isUsableBatchId("temp")).toBe(false)
    expect(isUsableBatchId("normandy-interviews-batch-001")).toBe(true)
    expect(extractionPathFor("normandy-interviews-batch-001")).toBe(
      "agent_reports/extraction_normandy-interviews-batch-001.md",
    )
  })

  test("formats packets with wikilinks", () => {
    const md = formatExtractionMarkdown({
      batchId: "coast-batch-001",
      packets: [
        {
          filename: "interview.md",
          path: "raw/interview.md",
          summary: "A coastal interview.",
          passages: [{ quote: "we moved inland", lines: "L2-L3" }],
          concepts: ["relocation"],
          tags: ["#concept/relocation", "#type/interview", "#group/coast"],
          connections: ["none"],
        },
      ],
    })
    expect(md).toContain("batch_id: coast-batch-001")
    expect(md).toContain("[[raw/interview]]")
    expect(md).toContain("files_processed: 1")
  })
})

describe("spinosaMap", () => {
  test("begin then write_extraction then cover", async () => {
    const root = await workspace()
    const started = await spinosaMap({
      action: "begin",
      workspacePath: root,
      batchId: "coast-batch-001",
      files: ["raw/interview.md"],
    })
    if (!started.ok) throw new Error(started.reason)
    expect(started.output).toContain('skip="false"')

    const written = await spinosaMap({
      action: "write_extraction",
      workspacePath: root,
      batchId: "coast-batch-001",
      files: ["raw/interview.md"],
      packets: [
        {
          filename: "interview.md",
          path: "raw/interview.md",
          summary: "Speakers discuss inland relocation after storms.",
          passages: [{ quote: "Coastal relocation notes.", lines: "L3" }],
          concepts: ["relocation"],
          tags: ["#concept/relocation", "#type/interview", "#group/coast"],
          connections: ["none"],
        },
      ],
    })
    if (!written.ok) throw new Error(written.reason)
    expect(written.output).toContain("agent_reports/extraction_coast-batch-001.md")

    const map = await spinosaMap({
      action: "write_map",
      workspacePath: root,
      mapPath: "maps/groups/coast.md",
      mapKind: "group",
      title: "Coast interviews",
      tags: ["#group/coast", "#concept/relocation"],
      body: "Interview notes on relocation. See [[raw/interview]] L3.",
    })
    if (!map.ok) throw new Error(map.reason)
    const group = await Bun.file(path.join(root, "maps/groups/coast.md")).text()
    expect(group).toContain("#group/coast")
    expect(group).toContain("[[corpus_overview]]")

    const covered = await spinosaMap({
      action: "cover",
      workspacePath: root,
      batchId: "coast-batch-001",
    })
    if (!covered.ok) throw new Error(covered.reason)
    expect(covered.output).toContain('ok="true"')
  })

  test("cover lists each file once despite table and wikilink forms", async () => {
    const root = await workspace()
    const written = await spinosaMap({
      action: "write_extraction",
      workspacePath: root,
      batchId: "coast-batch-001",
      files: ["raw/interview.md"],
      packets: [
        {
          filename: "interview.md",
          path: "raw/interview.md",
          summary: "Speakers discuss inland relocation after storms.",
          passages: [{ quote: "Coastal relocation notes.", lines: "L3" }],
          concepts: ["relocation"],
          tags: ["#concept/relocation", "#type/interview", "#group/coast"],
          connections: ["none"],
        },
      ],
    })
    if (!written.ok) throw new Error(written.reason)

    const covered = await spinosaMap({
      action: "cover",
      workspacePath: root,
      batchId: "coast-batch-001",
    })
    if (!covered.ok) throw new Error(covered.reason)
    expect(covered.output).toContain('missing="1"')
    expect(covered.output.match(/^- raw\/interview\.md$/gm)).toHaveLength(1)
  })

  test("begin skips an existing extraction", async () => {
    const root = await workspace()
    const first = await spinosaMap({
      action: "write_extraction",
      workspacePath: root,
      batchId: "coast-batch-001",
      files: ["raw/interview.md"],
      packets: [
        {
          filename: "interview.md",
          path: "raw/interview.md",
          summary: "Existing packet.",
          passages: [{ quote: "notes", lines: "L1" }],
        },
      ],
    })
    if (!first.ok) throw new Error(first.reason)
    const again = await spinosaMap({
      action: "begin",
      workspacePath: root,
      batchId: "coast-batch-001",
      files: ["raw/interview.md"],
    })
    if (!again.ok) throw new Error(again.reason)
    expect(again.output).toContain('skip="true"')
  })

  test("does not skip a partial extraction", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "agent_reports/extraction_coast-batch-001.md"),
      [
        "---",
        "type: extraction_batch",
        "batch_id: coast-batch-001",
        "files_expected: 2",
        "files_accounted: 1",
        "files_processed: 1",
        "---",
        "",
        "| File Path | Status |",
        "|---|---|",
        "| raw/interview.md | extracted |",
        "",
      ].join("\n"),
    )
    const again = await spinosaMap({
      action: "begin",
      workspacePath: root,
      batchId: "coast-batch-001",
      files: ["raw/interview.md", "raw/blocked-scan.pdf"],
    })
    if (!again.ok) throw new Error(again.reason)
    expect(again.output).toContain('skip="false"')
    expect(again.output).toContain("missing raw/blocked-scan.pdf")

    await Bun.write(
      path.join(root, "agent_reports/extraction_coast-batch-mismatch.md"),
      [
        "---",
        "type: extraction_batch",
        "batch_id: coast-batch-mismatch",
        "files_expected: 2",
        "files_accounted: 2",
        "files_processed: 1",
        "---",
        "",
        "| File Path | Status |",
        "|---|---|",
        "| raw/interview.md | extracted |",
        "| raw/blocked-scan.pdf | unreadable |",
        "",
      ].join("\n"),
    )
    const mismatched = await spinosaMap({
      action: "begin",
      workspacePath: root,
      batchId: "coast-batch-mismatch",
      files: ["raw/interview.md"],
    })
    if (!mismatched.ok) throw new Error(mismatched.reason)
    expect(mismatched.output).toContain('skip="false"')
    expect(mismatched.output).toContain("unexpected raw/blocked-scan.pdf")
  })

  test("counts unreadable files as accounted and skips a complete batch", async () => {
    const root = await workspace()
    const written = await spinosaMap({
      action: "write_extraction",
      workspacePath: root,
      batchId: "coast-batch-001",
      files: ["raw/interview.md", "raw/blocked-scan.pdf"],
      packets: [
        {
          filename: "interview.md",
          path: "raw/interview.md",
          summary: "Existing packet.",
          passages: [{ quote: "notes", lines: "L1" }],
        },
        { filename: "blocked-scan.pdf", path: "raw/blocked-scan.pdf", status: "unreadable" },
      ],
    })
    if (!written.ok) throw new Error(written.reason)
    const text = await Bun.file(path.join(root, "agent_reports/extraction_coast-batch-001.md")).text()
    expect(text).toContain("files_expected: 2")
    expect(text).toContain("files_accounted: 2")
    expect(text).toContain("files_processed: 1")
    const again = await spinosaMap({
      action: "begin",
      workspacePath: root,
      batchId: "coast-batch-001",
      files: ["raw/interview.md", "raw/blocked-scan.pdf"],
    })
    if (!again.ok) throw new Error(again.reason)
    expect(again.output).toContain('skip="true"')
  })

  test("requires an exact unique assignment for write_extraction", async () => {
    const root = await workspace()
    const packet = {
      filename: "interview.md",
      path: "raw/interview.md",
      summary: "Existing packet.",
      passages: [{ quote: "notes", lines: "L1" }],
    }
    const missingFiles = await spinosaMap({
      action: "write_extraction",
      workspacePath: root,
      batchId: "coast-batch-001",
      packets: [packet],
    })
    expect(missingFiles.ok).toBe(false)
    const duplicateFiles = await spinosaMap({
      action: "write_extraction",
      workspacePath: root,
      batchId: "coast-batch-002",
      files: ["raw/interview.md", "raw/interview.md"],
      packets: [packet],
    })
    expect(duplicateFiles.ok).toBe(false)
    const duplicatePackets = await spinosaMap({
      action: "write_extraction",
      workspacePath: root,
      batchId: "coast-batch-duplicate-packets",
      files: ["raw/interview.md", "raw/other.md"],
      packets: [packet, { ...packet, filename: "other.md" }],
    })
    expect(duplicatePackets.ok).toBe(false)
    const mismatchedPackets = await spinosaMap({
      action: "write_extraction",
      workspacePath: root,
      batchId: "coast-batch-003",
      files: ["raw/interview.md", "raw/other.md"],
      packets: [packet],
    })
    expect(mismatchedPackets.ok).toBe(false)
  })

  test("rejects malformed extraction metadata", async () => {
    const root = await workspace()
    const relativePath = "agent_reports/extraction_coast-batch-001.md"
    await Bun.write(
      path.join(root, relativePath),
      [
        "---",
        "type: extraction_batch",
        "batch_id: coast-batch-001",
        "files_expected: 2",
        "files_accounted: 1",
        "files_processed: 1",
        "---",
        "",
        "| File Path | Status |",
        "|---|---|",
        "| raw/interview.md | extracted |",
        "",
      ].join("\n"),
    )
    const checked = await spinosaMap({ action: "check", workspacePath: root, relativePath })
    expect(checked.ok).toBe(false)
    if (checked.ok) throw new Error("expected malformed extraction to fail")
    expect(checked.reason).toContain("files_expected")
  })

  test("rejects extraction metadata when a required field is missing", async () => {
    const root = await workspace()
    const relativePath = "agent_reports/extraction_coast-batch-001.md"
    await Bun.write(
      path.join(root, relativePath),
      [
        "---",
        "type: extraction_batch",
        "batch_id: coast-batch-001",
        "files_expected: 1",
        "files_accounted: 1",
        "---",
        "",
        "| File Path | Status |",
        "|---|---|",
        "| raw/interview.md | extracted |",
        "",
      ].join("\n"),
    )
    const checked = await spinosaMap({ action: "check", workspacePath: root, relativePath })
    expect(checked.ok).toBe(false)
    if (checked.ok) throw new Error("expected missing extraction metadata to fail")
    expect(checked.reason).toContain("files_processed")
  })

  test("rejects duplicate and malformed file rows", async () => {
    const root = await workspace()
    const relativePath = "agent_reports/extraction_coast-batch-001.md"
    await Bun.write(
      path.join(root, relativePath),
      [
        "---",
        "type: extraction_batch",
        "batch_id: coast-batch-001",
        "files_expected: 1",
        "files_accounted: 1",
        "files_processed: 1",
        "---",
        "",
        "| File Path | Status |",
        "|---|---|",
        "| raw/interview.md | extracted |",
        "| raw/interview.md | extracted |",
        "| raw/blocked-scan.pdf | failed |",
        "",
      ].join("\n"),
    )
    const checked = await spinosaMap({ action: "check", workspacePath: root, relativePath })
    expect(checked.ok).toBe(false)
    if (checked.ok) throw new Error("expected duplicate and malformed rows to fail")
    expect(checked.reason).toContain("duplicate file rows")

    await Bun.write(
      path.join(root, relativePath),
      [
        "---",
        "type: extraction_batch",
        "batch_id: coast-batch-001",
        "files_expected: 1",
        "files_accounted: 1",
        "files_processed: 1",
        "---",
        "",
        "| File Path | Status |",
        "|---|---|",
        "| raw/interview.md | extracted |",
        "| raw/blocked-scan.pdf | failed |",
        "",
      ].join("\n"),
    )
    const malformed = await spinosaMap({ action: "check", workspacePath: root, relativePath })
    expect(malformed.ok).toBe(false)
    if (malformed.ok) throw new Error("expected malformed file row to fail")
    expect(malformed.reason).toContain("malformed file rows")
  })

  test("refuses paths outside raw/ and maps/", async () => {
    const root = await workspace()
    const badFile = await spinosaMap({
      action: "begin",
      workspacePath: root,
      batchId: "coast-batch-001",
      files: ["../secret.md"],
    })
    expect(badFile.ok).toBe(false)
    const badMap = await spinosaMap({
      action: "write_map",
      workspacePath: root,
      mapPath: "agent_reports/not-a-map.md",
      title: "Nope",
      body: "[[raw/interview]]",
    })
    expect(badMap.ok).toBe(false)
  })
})
