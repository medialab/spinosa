import { describe, expect, test } from "bun:test"
import {
  buildRawWorkspaceGraph,
  loadRawWorkspaceGraph,
  normalizeWorkspacePath,
  type RawGraphClient,
} from "./raw-workspace-graph"

describe("raw workspace graph", () => {
  test("keeps every raw item and links header targets plus body wikilinks as undirected edges", () => {
    const graph = buildRawWorkspaceGraph([
      {
        path: "raw/interviews/alice.md",
        content: [
          "---",
          'title: "Alice interview"',
          "connects_to:",
          "  - raw/reports/study.md",
          "related_sources: [raw/reports/study.md]",
          "---",
          "See [[raw/reports/study|the study]].",
        ].join("\n"),
      },
      {
        path: "raw/reports/study.md",
        content: ["---", "related_sources:", "  - raw/interviews/alice.md", "---", "# The study"].join("\n"),
      },
      { path: "raw/scan.pdf" },
    ])

    expect(graph.nodes.map((node) => node.path)).toEqual([
      "raw/interviews/alice.md",
      "raw/reports/study.md",
      "raw/scan.pdf",
    ])
    expect(graph.nodes[0]).toMatchObject({ fileName: "alice.md", title: "Alice interview" })
    expect(graph.nodes[1]).toMatchObject({ title: "The study" })
    expect(graph.edges).toEqual([
      {
        source: "raw/interviews/alice.md",
        target: "raw/reports/study.md",
        kinds: ["header", "wikilink"],
      },
    ])
    expect(graph.unreadable).toBe(0)
  })

  test("keeps unreadable text files visible and ignores references outside raw/", () => {
    const graph = buildRawWorkspaceGraph([
      { path: "raw/a.md", unreadable: true },
      { path: "raw/b.md", content: "---\nconnects_to: ../private.md\n---\n[[../../outside.md]]" },
    ])

    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toEqual([])
    expect(graph.unreadable).toBe(1)
    expect(normalizeWorkspacePath("raw/../private.md")).toBe("private.md")
    expect(normalizeWorkspacePath("../../outside.md")).toBeUndefined()
    expect(() => buildRawWorkspaceGraph([{ path: "raw/../private.md" }])).toThrow("outside raw/")
  })

  test("connects documents that share meaningful header metadata without creating a dense clique", () => {
    const graph = buildRawWorkspaceGraph([
      { path: "raw/a.md", content: "---\ntopics: [Coastal, Migration]\n---" },
      { path: "raw/b.md", content: "---\ntopics:\n  - coastal\n---" },
      { path: "raw/c.md", content: "---\ntopics: coastal\n---" },
    ])

    expect(graph.edges).toEqual([
      { source: "raw/a.md", target: "raw/b.md", kinds: ["header"] },
      { source: "raw/b.md", target: "raw/c.md", kinds: ["header"] },
    ])
  })

  test("recursively inventories raw files, including ignored files, and reads only Markdown headers", async () => {
    const listings: Record<string, Array<{ path: string; type: "file" | "directory"; ignored?: boolean }>> = {
      raw: [
        { path: "raw/nested", type: "directory", ignored: true },
        { path: "raw/ignored.md", type: "file", ignored: true },
        { path: "raw/photo.png", type: "file" },
      ],
      "raw/nested": [{ path: "raw/nested/item.md", type: "file" }],
    }
    const reads: string[] = []
    const client = {
      file: {
        list: async ({ path }: { path: string }) => ({ data: listings[path] ?? [] }),
        read: async ({ path }: { path: string }) => {
          reads.push(path)
          return { data: { type: "text" as const, content: "---\ntitle: Item\n---\n" } }
        },
      },
    } as unknown as RawGraphClient

    const graph = await loadRawWorkspaceGraph(client, "/workspace")

    expect(reads.sort()).toEqual(["raw/ignored.md", "raw/nested/item.md"])
    expect(graph.nodes.map((node) => node.path)).toEqual(["raw/ignored.md", "raw/nested/item.md", "raw/photo.png"])
  })

  test("accepts direct SDK data results for file listings and reads", async () => {
    const client = {
      file: {
        list: async ({ path }: { path: string }) =>
          path === "raw" ? [{ path: "raw/note.md", type: "file" as const }] : [],
        read: async () => ({ type: "text" as const, content: "# Note" }),
      },
    } as unknown as RawGraphClient

    const graph = await loadRawWorkspaceGraph(client, "/workspace")

    expect(graph.nodes).toEqual([{ path: "raw/note.md", fileName: "note.md", title: "Note" }])
    expect(graph.unreadable).toBe(0)
  })
})
