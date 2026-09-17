export * as CustomTools from "./custom"

import path from "path"
import { pathToFileURL } from "url"
import { ToolFailure } from "@spinosa/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Global } from "../global"
import { Location } from "../location"
import { Glob } from "../util/glob"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

type DynamicSchema = Schema.Codec<unknown, unknown, never, never>

type JsonSchemaObject = Readonly<Record<string, unknown>>
type JsonSchemaDefinition = boolean | JsonSchemaObject

type ZodDefinition = Readonly<Record<string, unknown>> & {
  readonly type: string
}
type ZodLike = {
  readonly _zod: {
    readonly def: ZodDefinition
  }
  readonly description?: string
}

type PluginToolDefinition = {
  readonly description?: string
  readonly args?: unknown
  readonly execute: (args: Readonly<Record<string, unknown>>, context: PluginToolContext) => Promise<unknown>
}

type PluginToolAskInput = {
  readonly permission: string
  readonly patterns: ReadonlyArray<string>
  readonly always: ReadonlyArray<string>
  readonly metadata: Record<string, unknown>
}

type PluginToolContext = {
  readonly sessionID: string
  readonly messageID: string
  readonly agent: string
  readonly directory: string
  readonly worktree: string
  readonly abort: AbortSignal
  readonly metadata: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  readonly ask: (input: PluginToolAskInput) => Promise<void>
}

const MAX_ZOD_SCHEMA_DEPTH = 32

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isZodType(value: unknown): value is ZodLike {
  if (!isRecord(value) || !isRecord(value._zod) || !isRecord(value._zod.def)) return false
  if (typeof value._zod.def.type !== "string") return false
  return !("description" in value && value.description !== undefined && typeof value.description !== "string")
}

function isPluginTool(value: unknown): value is PluginToolDefinition {
  if (!isRecord(value)) return false
  return (!("description" in value) || typeof value.description === "string") && typeof value.execute === "function"
}

function isJsonSchemaDefinition(value: unknown): value is JsonSchemaDefinition {
  return typeof value === "boolean" || isRecord(value)
}

function annotateDescription(schema: DynamicSchema, description: unknown): DynamicSchema {
  if (typeof description !== "string" || schema.ast.annotations?.description !== undefined) return schema
  return schema.annotate({ description })
}

function jsonSchemaToEffectSchema(def: JsonSchemaDefinition): DynamicSchema {
  if (!isRecord(def)) return Schema.Unknown

  let schema: DynamicSchema
  switch (typeof def.type === "string" ? def.type : undefined) {
    case "string":
      schema = Schema.String
      break
    case "number":
    case "integer":
      schema = Schema.Number
      break
    case "boolean":
      schema = Schema.Boolean
      break
    case "array":
      schema = Schema.Array(Schema.Unknown)
      break
    case "object":
    default:
      schema = Schema.Unknown
      break
  }

  return annotateDescription(schema, def.description)
}

function unwrapZod(value: unknown): {
  readonly inner: unknown
  readonly optional: boolean
} {
  let current: unknown = value
  let optional = false
  const seen = new WeakSet<object>()

  for (let depth = 0; depth < MAX_ZOD_SCHEMA_DEPTH; depth++) {
    if (!isZodType(current)) return { inner: current, optional }
    if (seen.has(current)) return { inner: undefined, optional }
    seen.add(current)

    const type = current._zod.def.type
    if (type === "optional" || type === "nullable") {
      optional = true
      current = current._zod.def.innerType
    } else if (type === "default") {
      current = current._zod.def.innerType
    } else {
      return { inner: current, optional }
    }
  }

  return { inner: undefined, optional }
}

function isLiteralValue(value: unknown): value is string | number | boolean | bigint {
  return (
    typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
  )
}

function literalValuesToSchema(values: ReadonlyArray<unknown>): DynamicSchema {
  if (values.length === 0 || !values.every(isLiteralValue)) return Schema.Unknown
  if (values.length === 1) return Schema.Literal(values[0])
  return Schema.Union(values.map((value) => Schema.Literal(value)))
}

function zodEnumToEffectSchema(entries: unknown): DynamicSchema {
  if (entries === undefined) return Schema.String
  if (!isRecord(entries)) return Schema.Unknown
  const values = Object.values(entries)
  if (values.length === 0) return Schema.String
  return literalValuesToSchema(values)
}

type ZodTraversalState = {
  readonly active: WeakSet<object>
  readonly depth: number
}

function zodToEffectSchema(
  value: unknown,
  state: ZodTraversalState = { active: new WeakSet<object>(), depth: 0 },
): DynamicSchema {
  if (!isZodType(value)) return Schema.Unknown
  if (state.depth >= MAX_ZOD_SCHEMA_DEPTH || state.active.has(value)) return Schema.Unknown

  state.active.add(value)
  try {
    const def = value._zod.def
    let schema: DynamicSchema
    switch (def.type) {
      case "string":
        schema = Schema.String
        break
      case "number":
        schema = Schema.Number
        break
      case "boolean":
        schema = Schema.Boolean
        break
      case "array":
        schema = Schema.Array(
          zodToEffectSchema(def.element, {
            active: state.active,
            depth: state.depth + 1,
          }),
        )
        break
      case "enum":
        schema = zodEnumToEffectSchema(def.entries)
        break
      case "literal":
        schema = literalValuesToSchema(Array.isArray(def.values) ? def.values : [])
        break
      case "object":
      case "union":
      default:
        schema = Schema.Unknown
        break
    }
    return annotateDescription(schema, value.description)
  } finally {
    state.active.delete(value)
  }
}

function argsToInputSchema(args: unknown): DynamicSchema {
  if (!isRecord(args)) return Schema.Struct({})
  const entries = Object.entries(args)
  if (entries.length === 0) return Schema.Struct({})
  const fields: Record<string, DynamicSchema> = {}
  for (const [key, def] of entries) {
    if (isZodType(def)) {
      const { inner, optional } = unwrapZod(def)
      const schema = annotateDescription(zodToEffectSchema(inner), def.description)
      fields[key] = optional ? Schema.optional(schema) : schema
    } else if (isJsonSchemaDefinition(def)) {
      fields[key] = jsonSchemaToEffectSchema(def)
    } else {
      fields[key] = Schema.Unknown
    }
  }
  return Schema.Struct(fields)
}

function makeCoreTool(def: PluginToolDefinition, locationDir: string, worktree: string): Tool.AnyTool {
  const inputSchema: DynamicSchema = argsToInputSchema(def.args)
  const outputSchema = Schema.String

  return Tool.make({
    description: def.description ?? "",
    input: inputSchema,
    output: outputSchema,
    execute: (input: unknown, context: Tool.Context) =>
      Effect.gen(function* () {
        const pluginCtx: PluginToolContext = {
          sessionID: String(context.sessionID),
          messageID: String(context.assistantMessageID),
          agent: String(context.agent),
          directory: locationDir,
          worktree,
          abort: context.abort ?? new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
        }
        const result = yield* Effect.tryPromise({
          try: () => def.execute(isRecord(input) ? input : {}, pluginCtx),
          catch: (cause) =>
            new ToolFailure({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        })
        if (typeof result === "string") return result
        if (isRecord(result) && "output" in result) {
          const output = result.output
          if (typeof output === "string") return output
          if (output != null) return String(output)
        }
        if (result == null) return ""
        return String(result)
      }).pipe(
        Effect.mapError((error) =>
          error instanceof ToolFailure ? error : new ToolFailure({ message: String(error) }),
        ),
      ),
  })
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const location = yield* Location.Service
    const global = yield* Global.Service

    const locationDir = location.directory
    const worktree = location.project.directory ?? location.directory

    const projectToolsDirs = [
      path.join(locationDir, ".spinosa", "tools"),
      path.join(locationDir, ".spinosa", "tool"),
    ]
    const globalToolsDirs = [path.join(global.config, "tools"), path.join(global.config, "tool")]
    const dirs = [...new Set([...projectToolsDirs, ...globalToolsDirs])]

    const matches: string[] = []
    for (const dir of dirs) {
      try {
        const files = Glob.scanSync("*.{js,ts}", { cwd: dir, absolute: true })
        matches.push(...files)
      } catch (cause) {
        yield* Effect.logDebug(`custom-tools scan failed for ${dir}: ${String(cause)}`)
      }
    }

    if (matches.length === 0) return

    const uniqueMatches = [...new Set(matches)]
    const registrations: Record<string, Tool.AnyTool> = {}

    for (const match of uniqueMatches) {
      const namespace = path.basename(match, path.extname(match))
      const loaded = yield* Effect.tryPromise({
        try: () => import(pathToFileURL(match).href),
        catch: (cause) => cause,
      }).pipe(
        Effect.map((mod) => (isRecord(mod) ? { ok: true as const, mod } : { ok: false as const })),
        Effect.catch(() => Effect.succeed({ ok: false as const })),
      )
      if (!loaded.ok) {
        yield* Effect.logWarning(`Skipping custom tool file (import failed): ${match}`)
        continue
      }
      const mod = loaded.mod

      for (const [id, def] of Object.entries(mod)) {
        if (!isPluginTool(def)) continue
        const toolName = id === "default" ? namespace : `${namespace}_${id}`
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(toolName)) {
          yield* Effect.logWarning(`Skipping custom tool with invalid name ${toolName} from ${match}`)
          continue
        }
        try {
          const coreTool = makeCoreTool(def, locationDir, worktree)
          registrations[toolName] = coreTool
        } catch (cause) {
          yield* Effect.logWarning(`Failed to convert custom tool ${toolName} from ${match}: ${String(cause)}`)
        }
      }
    }

    if (Object.keys(registrations).length === 0) return

    yield* tools.register(registrations).pipe(
      Effect.catchTag("Tool.RegistrationError", (error) =>
        Effect.logWarning(`Custom tool registration failed: ${error.message}`),
      ),
      Effect.orDie,
    )
  }),
)

export const node = makeLocationNode({
  name: "tool/custom",
  layer,
  deps: [ToolRegistry.node, Location.node, Global.node],
})
