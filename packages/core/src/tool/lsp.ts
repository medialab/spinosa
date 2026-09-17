export * as LspTool from "./lsp"

import { ToolFailure } from "@spinosa/llm"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

export const name = "lsp"

const DESCRIPTION = `Interact with Language Server Protocol (LSP) servers to get code intelligence features.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: List project-wide symbols matching a query string
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)
- incomingCalls: Find all functions/methods that call the function at a position
- outgoingCalls: Find all functions/methods called by the function at a position

All operations require:
- filePath: The file to operate on
- line: The line number (1-based, as shown in editors)
- character: The character offset (1-based, as shown in editors)

workspaceSymbol also accepts:
- query: A query string to filter symbols by. Empty string requests all symbols.

For workspaceSymbol, filePath is not sent in the LSP workspace/symbol request. It is used by opencode to select and start the matching LSP server.

Note: LSP servers must be configured for the file type. If no server is available, an error will be returned.`

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

export const Input = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "The LSP operation to perform" }),
  filePath: Schema.String.annotate({ description: "The absolute or relative path to the file" }),
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The line number (1-based, as shown in editors)",
  }),
  character: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The character offset (1-based, as shown in editors)",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Search query for workspaceSymbol. Empty string requests all symbols.",
  }),
})
export type Input = typeof Input.Type

export const Output = Schema.String
export type Output = typeof Output.Type

export function isLspEnabled(): boolean {
  const env = process.env as Record<string, string | undefined>
  const broad = env.SPINOSA_EXPERIMENTAL ?? env.OPENCODE_EXPERIMENTAL
  const direct = env.SPINOSA_EXPERIMENTAL_LSP_TOOL ?? env.OPENCODE_EXPERIMENTAL_LSP_TOOL
  const parse = (value: string | undefined) => value !== undefined && ["true", "1", "yes"].includes(value.toLowerCase())
  return parse(direct) || parse(broad)
}

/**
 * Core LSP leaf. Mirrors spinosa-kernel/src/tool/lsp.ts but uses Core's
 * Tool.make + PermissionV2 + makeLocationNode. Gated by
 * SPINOSA_EXPERIMENTAL_LSP_TOOL / OPENCODE_EXPERIMENTAL_LSP_TOOL or
 * SPINOSA_EXPERIMENTAL (RuntimeFlags semantics). Until the V2 LSP runtime
 * exists, the executor validates the file and permission then returns the
 * standard "No LSP server available" error so the tool surface can be tested
 * and gated without a live language server.
 */
// TODO: Wire V2 LSP runtime after it exists. Replace the stub hasClients/touchFile
// checks with a real Location-scoped LSP service and surface diagnostics.
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (!isLspEnabled()) return
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description: DESCRIPTION,
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: output }],
            execute: (args, context) =>
              Effect.gen(function* () {
                const source = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }

                const target = yield* mutation.resolve({ path: args.filePath, kind: "file" }).pipe(
                  Effect.mapError(
                    (cause) =>
                      new ToolFailure({
                        message: cause instanceof Error ? cause.message : `Unable to resolve ${args.filePath}`,
                      }),
                  ),
                )

                const external = target.externalDirectory
                if (external) {
                  yield* permission
                    .assert({
                      ...LocationMutation.externalDirectoryPermission(external),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source,
                    })
                    .pipe(
                      Effect.mapError((cause) =>
                        cause instanceof ToolFailure
                          ? cause
                          : new ToolFailure({
                              message: cause instanceof Error ? cause.message : `Permission denied: external_directory`,
                            }),
                      ),
                    )
                }

                const meta =
                  args.operation === "workspaceSymbol"
                    ? { operation: args.operation }
                    : args.operation === "documentSymbol"
                      ? { operation: args.operation, filePath: target.canonical }
                      : {
                          operation: args.operation,
                          filePath: target.canonical,
                          line: args.line,
                          character: args.character,
                        }

                yield* permission
                  .assert({
                    action: "lsp",
                    resources: ["*"],
                    save: ["*"],
                    metadata: meta,
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  })
                  .pipe(
                    Effect.mapError((cause) =>
                      cause instanceof ToolFailure
                        ? cause
                        : cause instanceof PermissionV2.DeniedError
                          ? new ToolFailure({ message: `Permission denied: lsp (${args.operation})` })
                          : new ToolFailure({
                              message: cause instanceof Error ? cause.message : `Permission denied: lsp`,
                            }),
                    ),
                  )

                // Validate file exists. Kernel uses FSUtil.existsSafe; core uses FSUtil.existsSafe as well.
                const exists = yield* fs.existsSafe(target.canonical).pipe(
                  Effect.mapError(
                    () => new ToolFailure({ message: `File not found: ${target.canonical}` }),
                  ),
                )
                if (!exists) return yield* new ToolFailure({ message: `File not found: ${target.canonical}` })

                // Touch file and LSP dispatch would go here once V2 LSP runtime exists.
                // Preserve the kernel's URI/position derivation so the future wiring is trivial.
                const _uri = pathToFileURL(target.canonical).href
                const _position = { file: target.canonical, line: args.line - 1, character: args.character - 1 }
                const _relPath = path.relative(".", target.resource)

                // Stub: no LSP servers are available in core yet. Keep the kernel's error
                // shape so callers see the expected message.
                return yield* new ToolFailure({
                  message: "No LSP server available for this file type.",
                })

                // Future real implementation (uncomment when LSP.Service exists):
                // yield* lsp.touchFile(target.canonical, "document")
                // const available = yield* lsp.hasClients(target.canonical)
                // if (!available) return yield* new ToolFailure({ message: "No LSP server available for this file type." })
                // const result: unknown[] = yield* (() => { switch (...) })()
                // return result.length === 0 ? `No results found for ${args.operation}` : JSON.stringify(result, null, 2)
              }).pipe(
                Effect.mapError((error: unknown) =>
                  error instanceof ToolFailure
                    ? error
                    : new ToolFailure({
                        message: error instanceof Error ? error.message : `Unable to perform ${args.operation}`,
                      }),
                ),
              ),
          }),
          "lsp",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/lsp",
  layer,
  deps: [ToolRegistry.node, LocationMutation.node, FSUtil.node, PermissionV2.node],
})
