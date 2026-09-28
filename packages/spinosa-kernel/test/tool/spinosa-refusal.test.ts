import { LayerNode } from "@spinosa/kernel-core/effect/layer-node"
import { CrossSpawnSpawner } from "@spinosa/kernel-core/cross-spawn-spawner"
import { FSUtil } from "@spinosa/kernel-core/fs-util"
import { Ripgrep } from "@spinosa/kernel-core/ripgrep"
import { LSP } from "@/lsp/lsp"
import { Cause, Effect, Exit, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Instruction } from "../../src/session/instruction"
import { SessionID, MessageID } from "../../src/session/schema"
import { Truncate } from "@/tool/truncate"
import type { Tool } from "@/tool/tool"
import { SpinosaMapTool } from "../../src/tool/spinosa-map"
import { SpinosaFrameTool } from "../../src/tool/spinosa-frame"
import { SpinosaMintPathsTool } from "../../src/tool/spinosa-mint-paths"
import { SpinosaFigureTool } from "../../src/tool/spinosa-figure"
import { SpinosaVerifyTool } from "../../src/tool/spinosa-verify"
import { SpinosaGateTool } from "../../src/tool/spinosa-gate"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(
      LayerNode.group([
        Agent.node,
        FSUtil.node,
        CrossSpawnSpawner.node,
        Instruction.node,
        LSP.node,
        Ripgrep.node,
        Truncate.node,
      ]),
    ),
    testInstanceStoreLayer,
  ),
)

async function markWorkspace(dir: string): Promise<void> {
  await Bun.write(path.join(dir, ".spinosa", "workspace"), "setup_status: workspace_started\nframework_version: 0.0.0-test\n")
}

function failureMessage(exit: Exit.Exit<unknown, unknown>): string {
  if (!Exit.isFailure(exit)) return ""
  return Cause.pretty(exit.cause)
}

describe("spinosa tool refusals settle as errors", () => {
  it.instance("spinosa_map write_extraction without packets fails", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() => markWorkspace(dir))
      const tool = yield* SpinosaMapTool
      const def = yield* tool.init()
      const exit = yield* provideInstance(dir)(
        def.execute({ action: "write_extraction", batchId: "some-batch-001", files: ["raw/a.md"] }, ctx),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(failureMessage(exit)).toContain("needs packets")
    }),
  )

  it.instance("spinosa_map write_extraction with packet/files mismatch fails", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() => markWorkspace(dir))
      const tool = yield* SpinosaMapTool
      const def = yield* tool.init()
      const exit = yield* provideInstance(dir)(
        def.execute(
          {
            action: "write_extraction",
            batchId: "some-batch-001",
            files: ["raw/a.md", "raw/b.md"],
            packets: [
              {
                filename: "a.md",
                path: "raw/a.md",
                summary: "Summary of A.",
                passages: [{ quote: "hello" }],
              },
            ],
          },
          ctx,
        ),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(failureMessage(exit)).toContain("exactly match")
    }),
  )

  it.instance("spinosa_frame outside a workspace fails", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const tool = yield* SpinosaFrameTool
      const def = yield* tool.init()
      const exit = yield* provideInstance(dir)(
        def.execute(
          {
            cleanedPrompt: "index this workspace",
            decision: {
              mode: "orchestrated",
              operation: "research",
              strategy: "startup_index",
              scope: "local",
              coverage: "sufficient",
              outputs: ["chat"],
              mutation: "none",
              verification: "normal",
              evaluation: "never",
              reason: "test",
              confidence: 0.5,
            },
          },
          ctx,
        ),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(failureMessage(exit)).toContain("not a Spinosa workspace")
    }),
  )

  it.instance("spinosa_mint_paths with a bad runID fails", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const tool = yield* SpinosaMintPathsTool
      const def = yield* tool.init()
      const exit = yield* provideInstance(dir)(
        def.execute({ runID: "not-a-run-id", kinds: ["goal"] }, ctx),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(failureMessage(exit)).toContain("runID")
    }),
  )

  it.instance("spinosa_figure with an empty title fails", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const tool = yield* SpinosaFigureTool
      const def = yield* tool.init()
      const exit = yield* provideInstance(dir)(
        def.execute(
          { kind: "bar", title: "  ", caption: "c", source: "s", units: "u", items: [] },
          ctx,
        ),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(failureMessage(exit)).toContain("title is required")
    }),
  )

  it.instance("spinosa_verify of a missing artifact fails", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* Effect.promise(() => markWorkspace(dir))
      const tool = yield* SpinosaVerifyTool
      const def = yield* tool.init()
      const exit = yield* provideInstance(dir)(
        def.execute({ relativePath: "agent_reports/nope.md", validator: "report" }, ctx),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.instance("spinosa_gate failure stays a successful check result", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const tool = yield* SpinosaGateTool
      const def = yield* tool.init()
      const exit = yield* provideInstance(dir)(
        def.execute({ coverage: "exhaustive", sourceCount: 0, partitionsAccounted: 0, partitionsTotal: 5 }, ctx),
      ).pipe(Effect.exit)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.title).toContain("Gate failed")
        expect(exit.value.output).toContain('pass="false"')
      }
    }),
  )
})
