import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@spinosa/kernel-core/effect/app-node-builder"
import { LayerNode } from "@spinosa/kernel-core/effect/layer-node"
import { Global } from "@spinosa/kernel-core/global"
import { Location } from "@spinosa/kernel-core/location"
import { AbsolutePath } from "@spinosa/kernel-core/schema"
import { SessionV2 } from "@spinosa/kernel-core/session"
import { ToolOutputStore } from "@spinosa/kernel-core/tool-output-store"
import { ToolRegistry } from "@spinosa/kernel-core/tool/registry"
import { CustomTools } from "@spinosa/kernel-core/tool/custom"
import { tmpdir } from "./fixture/tmpdir"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { executeTool, toolDefinitions, toolIdentity } from "./lib/tool"

const customToolsSource = `
const cyclic = { _zod: { def: { type: "array" } } }
cyclic._zod.def.element = cyclic

export const malformed = {
  description: "Malformed schema",
  args: { value: { _zod: { def: null } } },
  execute: async (input) => String(input.value),
}

export const unsupported = {
  description: "Unsupported schema",
  args: { value: { _zod: { def: { type: "object", shape: {} } } } },
  execute: async (input) => String(input.value),
}

export const cyclicTool = {
  description: "Cyclic schema",
  args: { value: cyclic },
  execute: async () => "cycle handled",
}

export const malformedArgs = {
  description: "Malformed args",
  args: "not a record",
  execute: async () => "args handled",
}

export const strict = {
  description: "Strict schema",
  args: { value: { _zod: { def: { type: "string" } } } },
  execute: async () => "should not execute",
}

export const primitives = {
  description: "Primitive schemas",
  args: {
    text: { _zod: { def: { type: "string" } }, description: "Text value" },
    count: { _zod: { def: { type: "number" } } },
    enabled: { _zod: { def: { type: "boolean" } } },
    tags: { _zod: { def: { type: "array", element: { _zod: { def: { type: "string" } } } } } },
    mode: { _zod: { def: { type: "enum", entries: { FAST: "fast", SLOW: "slow" } } } },
    choice: { _zod: { def: { type: "literal", values: ["a", "b"] } } },
    maybe: { _zod: { def: { type: "optional", innerType: { _zod: { def: { type: "string" } } } } } },
  },
  execute: async (input) => ({
    output:
      input.text +
      ":" +
      input.count +
      ":" +
      input.enabled +
      ":" +
      input.tags.join(",") +
      ":" +
      input.mode +
      ":" +
      input.choice +
      ":" +
      (input.maybe ?? "none"),
  }),
}

export const jsonSchema = {
  description: "JSON schema",
  args: {
    text: { type: "string", description: "JSON text" },
    count: { type: "integer" },
    enabled: { type: "boolean" },
    values: { type: "array" },
  },
  execute: async (input) => input.text + ":" + input.count + ":" + input.enabled + ":" + input.values.length,
}

export const undocumented = {
  args: {},
  execute: async () => "undocumented works",
}

export const malformedDescription = {
  description: "Malformed description metadata",
  args: { value: { _zod: { def: { type: "string" } }, description: 42 } },
  execute: async (input) => String(input.value),
}

export const notATool = {
  description: "Invalid execute member",
  execute: "not callable",
}

export const numericOutput = {
  description: "Numeric output",
  args: {},
  execute: async () => ({ output: 7 }),
}

export const failing = {
  description: "Failing tool",
  args: {},
  execute: async () => {
    throw new Error("plugin failure")
  },
}
`

function customToolLayer(root: string) {
  const ref = Location.Ref.make({ directory: AbsolutePath.make(root) })
  return AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, CustomTools.node]), [
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    [Location.node, Layer.succeed(Location.Service, Location.Service.of(location(ref)))],
    [Global.node, Global.layerWith({ config: root, data: root })],
  ])
}

const withCustomTools = <A>(body: (root: string) => Effect.Effect<A, unknown, ToolRegistry.Service>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) =>
      Effect.gen(function* () {
        const toolsDirectory = path.join(tmp.path, ".spinosa", "tools")
        yield* Effect.promise(() => fs.mkdir(toolsDirectory, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(toolsDirectory, "ingress.js"), customToolsSource))
        yield* Effect.promise(() => fs.writeFile(path.join(toolsDirectory, "broken.js"), "export const ="))
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(toolsDirectory, "invalid.name.js"),
            'export default { execute: async () => "invalid name" }',
          ),
        )
        return yield* body(tmp.path).pipe(Effect.provide(customToolLayer(tmp.path)))
      }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const customIt = testEffect(Layer.empty as Layer.Layer<ToolRegistry.Service, never>)

describe("CustomTools", () => {
  customIt.live("registers malformed, unsupported, cyclic, and non-record schemas safely", () =>
    withCustomTools((root) =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const names = (yield* toolDefinitions(registry)).map((definition) => definition.name).sort()
        expect(names).toEqual([
          "ingress_cyclicTool",
          "ingress_failing",
          "ingress_jsonSchema",
          "ingress_malformed",
          "ingress_malformedArgs",
          "ingress_malformedDescription",
          "ingress_numericOutput",
          "ingress_primitives",
          "ingress_strict",
          "ingress_undocumented",
          "ingress_unsupported",
        ])

        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_malformed"),
            call: {
              type: "tool-call",
              id: "call-malformed",
              name: "ingress_malformed",
              input: { value: "ok" },
            },
          }),
        ).toEqual({ type: "text", value: "ok" })
        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_unsupported"),
            call: {
              type: "tool-call",
              id: "call-unsupported",
              name: "ingress_unsupported",
              input: { value: "ok" },
            },
          }),
        ).toEqual({ type: "text", value: "ok" })
        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_cycle"),
            call: {
              type: "tool-call",
              id: "call-cycle",
              name: "ingress_cyclicTool",
              input: { value: [1] },
            },
          }),
        ).toEqual({ type: "text", value: "cycle handled" })
        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_args"),
            call: {
              type: "tool-call",
              id: "call-args",
              name: "ingress_malformedArgs",
              input: {},
            },
          }),
        ).toEqual({ type: "text", value: "args handled" })
      }),
    ),
  )

  customIt.live("returns a tool error when converted schema rejects input", () =>
    withCustomTools((_root) =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_invalid"),
            call: {
              type: "tool-call",
              id: "call-invalid",
              name: "ingress_strict",
              input: { value: 42 },
            },
          }),
        ).toEqual({
          type: "error",
          value: expect.stringContaining("Invalid tool input"),
        })
      }),
    ),
  )

  customIt.live("converts valid schemas and enforces their contracts", () =>
    withCustomTools((_root) =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const definitions = yield* toolDefinitions(registry)
        const jsonDefinition = definitions.find((definition) => definition.name === "ingress_jsonSchema")
        expect(jsonDefinition?.inputSchema).toMatchObject({
          type: "object",
          properties: {
            text: { type: "string", description: "JSON text" },
            count: expect.any(Object),
            enabled: { type: "boolean" },
            values: { type: "array" },
          },
        })

        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_primitives"),
            call: {
              type: "tool-call",
              id: "call-primitives",
              name: "ingress_primitives",
              input: {
                text: "hello",
                count: 2,
                enabled: true,
                tags: ["a", "b"],
                mode: "fast",
                choice: "a",
              },
            },
          }),
        ).toEqual({ type: "text", value: "hello:2:true:a,b:fast:a:none" })

        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_json"),
            call: {
              type: "tool-call",
              id: "call-json",
              name: "ingress_jsonSchema",
              input: { text: "json", count: 3, enabled: false, values: [1, 2] },
            },
          }),
        ).toEqual({ type: "text", value: "json:3:false:2" })

        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_invalid_enum"),
            call: {
              type: "tool-call",
              id: "call-invalid-enum",
              name: "ingress_primitives",
              input: {
                text: "hello",
                count: 2,
                enabled: true,
                tags: ["a"],
                mode: "unknown",
                choice: "a",
              },
            },
          }),
        ).toEqual({
          type: "error",
          value: expect.stringContaining("Invalid tool input"),
        })

        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_invalid_array"),
            call: {
              type: "tool-call",
              id: "call-invalid-array",
              name: "ingress_primitives",
              input: {
                text: "hello",
                count: 2,
                enabled: true,
                tags: [42],
                mode: "fast",
                choice: "a",
              },
            },
          }),
        ).toEqual({
          type: "error",
          value: expect.stringContaining("Invalid tool input"),
        })

        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_numeric_output"),
            call: {
              type: "tool-call",
              id: "call-numeric-output",
              name: "ingress_numericOutput",
              input: {},
            },
          }),
        ).toEqual({ type: "text", value: "7" })

        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_failure"),
            call: {
              type: "tool-call",
              id: "call-failure",
              name: "ingress_failing",
              input: {},
            },
          }),
        ).toEqual({
          type: "error",
          value: expect.stringContaining("plugin failure"),
        })

        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_undocumented"),
            call: {
              type: "tool-call",
              id: "call-undocumented",
              name: "ingress_undocumented",
              input: {},
            },
          }),
        ).toEqual({ type: "text", value: "undocumented works" })

        expect(
          yield* executeTool(registry, {
            ...toolIdentity,
            sessionID: SessionV2.ID.make("ses_custom_bad_description"),
            call: {
              type: "tool-call",
              id: "call-bad-description",
              name: "ingress_malformedDescription",
              input: { value: 42 },
            },
          }),
        ).toEqual({ type: "text", value: "42" })
      }),
    ),
  )
})
