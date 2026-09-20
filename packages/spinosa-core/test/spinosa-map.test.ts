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

  test("begin skips an existing extraction", async () => {
    const root = await workspace()
    const first = await spinosaMap({
      action: "write_extraction",
      workspacePath: root,
      batchId: "coast-batch-001",
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
