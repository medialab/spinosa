import { ConfigV1 } from "@spinosa/kernel-core/v1/config/config"
import { EventV2 } from "@spinosa/kernel-core/event"
import { EventManifest } from "@/event-manifest"
import { InstanceDisposed } from "@/server/event"
import "@spinosa/kernel-core/account"
import "@/server/event"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

const GlobalHealth = Schema.Struct({
  healthy: Schema.Literal(true),
  version: Schema.String,
})

const SyncEventSchemas = EventManifest.Latest.values()
  .flatMap((definition) => {
    if (!definition.durable) return []
    return [
      Schema.Struct({
        type: Schema.Literal("sync"),
        id: EventV2.ID,
        syncEvent: Schema.Struct({
          type: Schema.Literal(EventV2.versionedType(definition.type, definition.durable.version)),
          id: EventV2.ID,
          seq: Schema.Finite,
          aggregateID: Schema.String,
          data: definition.data,
        }),
      }).annotate({ identifier: `SyncEvent.${definition.type}` }),
    ]
  })
  .toArray()

const GlobalEventSchema = Schema.Struct({
  directory: Schema.String,
  project: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  payload: Schema.Union([
    ...EventManifest.Latest.values()
      .map((definition) =>
        Schema.Struct({ id: EventV2.ID, type: Schema.Literal(definition.type), properties: definition.data }),
      )
      .toArray(),
    InstanceDisposed,
    ...SyncEventSchemas,
  ]),
}).annotate({ identifier: "GlobalEvent" })

export const GlobalUpgradeInput = Schema.Struct({
  target: Schema.optional(Schema.String),
})

const GlobalUpgradeResult = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    version: Schema.String,
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
  }),
])

const RegisteredWorkspace = Schema.Struct({
  path: Schema.String,
  projectName: Schema.String,
  workspaceID: Schema.optional(Schema.String),
  sourceLocation: Schema.optional(Schema.String),
  presence: Schema.Union([
    Schema.Literal("unknown"),
    Schema.Literal("present"),
    Schema.Literal("legacy"),
    Schema.Literal("moved"),
    Schema.Literal("non_existent"),
    Schema.Literal("invalid"),
    Schema.Literal("identity_mismatch"),
  ]),
  setupStatus: Schema.Union([
    Schema.Literal("not_started"),
    Schema.Literal("importing"),
    Schema.Literal("cli_started"),
    Schema.Literal("workspace_started"),
    Schema.Literal("unknown"),
  ]),
  registeredAt: Schema.String,
  tags: Schema.Array(Schema.String),
})

const RecoverWorkspaceInput = Schema.Struct({
  indexedPath: Schema.String,
  candidatePath: Schema.String,
  projectName: Schema.String,
  workspaceID: Schema.optional(Schema.String),
})

const ScanRecoverWorkspaceInput = Schema.Struct({
  indexedPath: Schema.String,
  projectName: Schema.String,
  workspaceID: Schema.String,
  roots: Schema.optional(Schema.Array(Schema.String)),
})

const ScanRecoverWorkspaceResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("found"), path: Schema.String }),
  Schema.Struct({ status: Schema.Literal("not_found") }),
  Schema.Struct({ status: Schema.Literal("ambiguous"), matches: Schema.Array(Schema.String) }),
])

export const GlobalPaths = {
  health: "/global/health",
  event: "/global/event",
  config: "/global/config",
  dispose: "/global/dispose",
  upgrade: "/global/upgrade",
  workspaces: "/global/spinosa/workspaces",
  workspaceRecover: "/global/spinosa/workspaces/recover",
  workspaceScanRecover: "/global/spinosa/workspaces/recover-scan",
  workspaceUnregister: "/global/spinosa/workspaces/unregister",
} as const

export const GlobalApi = HttpApi.make("global").add(
  HttpApiGroup.make("global")
    .add(
      HttpApiEndpoint.get("health", GlobalPaths.health, {
        success: described(GlobalHealth, "Health information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.health",
          summary: "Get health",
          description: "Get health information about the Spinosa server.",
        }),
      ),
      HttpApiEndpoint.get("event", GlobalPaths.event, {
        success: GlobalEventSchema,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.event",
          summary: "Get global events",
          description: "Subscribe to global events from the Spinosa system using server-sent events.",
        }),
      ),
      HttpApiEndpoint.get("configGet", GlobalPaths.config, {
        success: described(ConfigV1.Info, "Get global config info"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.get",
          summary: "Get global configuration",
          description: "Retrieve the current global Spinosa configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.patch("configUpdate", GlobalPaths.config, {
        payload: ConfigV1.Info,
        success: described(ConfigV1.Info, "Successfully updated global config"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.update",
          summary: "Update global configuration",
          description: "Update global Spinosa configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.post("dispose", GlobalPaths.dispose, {
        success: described(Schema.Boolean, "Global disposed"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.dispose",
          summary: "Dispose instance",
          description: "Clean up and dispose all Spinosa instances, releasing all resources.",
        }),
      ),
      HttpApiEndpoint.post("upgrade", GlobalPaths.upgrade, {
        payload: [HttpApiSchema.NoContent, GlobalUpgradeInput],
        success: described(GlobalUpgradeResult, "Upgrade result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.upgrade",
          summary: "Upgrade spinosa",
          description: "Upgrade spinosa to the specified version or latest if not specified.",
        }),
      ),
      HttpApiEndpoint.get("workspaces", GlobalPaths.workspaces, {
        success: described(Schema.Array(RegisteredWorkspace), "Registered Spinosa workspaces"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.spinosa.workspaces.list",
          summary: "List registered Spinosa workspaces",
          description: "List registry-backed workspaces, including missing and incomplete entries.",
        }),
      ),
      HttpApiEndpoint.post("workspaceRecover", GlobalPaths.workspaceRecover, {
        payload: RecoverWorkspaceInput,
        success: described(Schema.Struct({ path: Schema.String }), "Recovered workspace path"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.spinosa.workspaces.recover",
          summary: "Recover a registered workspace at a new path",
          description: "Validate a Spinosa marker and update the local workspace registry without moving files.",
        }),
      ),
      HttpApiEndpoint.post("workspaceScanRecover", GlobalPaths.workspaceScanRecover, {
        payload: ScanRecoverWorkspaceInput,
        success: described(ScanRecoverWorkspaceResult, "Workspace recovery scan result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.spinosa.workspaces.recover.scan",
          summary: "Find a missing workspace by identity",
          description: "Search local recovery roots for a matching Spinosa workspace marker and recover a unique match.",
        }),
      ),
      HttpApiEndpoint.post("workspaceUnregister", GlobalPaths.workspaceUnregister, {
        payload: Schema.Struct({ path: Schema.String }),
        success: described(Schema.Boolean, "Whether the workspace registry was updated"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.spinosa.workspaces.unregister",
          summary: "Remove a workspace from the registry",
          description: "Unregister a workspace without deleting its files.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "global", description: "Global server routes." })),
)
