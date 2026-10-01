import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/experimental/spinosa/workspace"

export const SpinosaWorkspacePaths = {
  startupPrompt: `${root}/startup-prompt`,
  freshness: `${root}/freshness`,
  update: `${root}/update`,
} as const

const StartupChatPrompt = Schema.Struct({
  input: Schema.String,
  parts: Schema.Array(Schema.Unknown),
  autoSubmit: Schema.Literal(false),
  forceAgent: Schema.Literal("build"),
})

const TemplatePackFreshness = Schema.Struct({
  stale: Schema.Boolean,
  refreshRecommended: Schema.Boolean,
  versionBehind: Schema.Boolean,
  versionAhead: Schema.Boolean,
  protocolBehind: Schema.Boolean,
  workspaceVersion: Schema.optional(Schema.String),
  bundledVersion: Schema.optional(Schema.String),
  stalePaths: Schema.Array(Schema.String),
  missingPaths: Schema.Array(Schema.String),
  message: Schema.String,
})

const WorkspaceUpdate = Schema.Struct({
  success: Schema.Boolean,
  added: Schema.Number,
  updated: Schema.Number,
  removed: Schema.Number,
  skipped: Schema.Number,
  changes: Schema.Boolean,
  presence: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})

const UpdateResult = Schema.Struct({
  before: TemplatePackFreshness,
  update: WorkspaceUpdate,
  freshness: TemplatePackFreshness,
  restartRequired: Schema.Boolean,
  restartMessage: Schema.optional(Schema.String),
})

export class ApiSpinosaWorkspaceTargetError extends Schema.ErrorClass<ApiSpinosaWorkspaceTargetError>(
  "SpinosaWorkspaceTargetError",
)(
  {
    name: Schema.Literal("SpinosaWorkspaceTargetError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}

export class ApiSpinosaFrameworkUnavailableError extends Schema.ErrorClass<ApiSpinosaFrameworkUnavailableError>(
  "SpinosaFrameworkUnavailableError",
)(
  {
    name: Schema.Literal("SpinosaFrameworkUnavailableError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 503 },
) {}

export class ApiSpinosaWorkspaceOperationError extends Schema.ErrorClass<ApiSpinosaWorkspaceOperationError>(
  "SpinosaWorkspaceOperationError",
)(
  {
    name: Schema.Literal("SpinosaWorkspaceOperationError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 500 },
) {}

export const SpinosaWorkspaceGroup = HttpApiGroup.make("spinosaWorkspace")
  .add(
    HttpApiEndpoint.get("startupPrompt", SpinosaWorkspacePaths.startupPrompt, {
      query: WorkspaceRoutingQuery,
      success: described(StartupChatPrompt, "Canonical review-first workspace startup prompt"),
      error: [ApiSpinosaWorkspaceTargetError, ApiSpinosaWorkspaceOperationError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.spinosa.workspace.startup-prompt",
        summary: "Prepare the canonical Spinosa workspace startup prompt",
        description:
          "Read the workspace startup brief and return the same review-first prompt payload used by the TUI.",
      }),
    ),
    HttpApiEndpoint.get("freshness", SpinosaWorkspacePaths.freshness, {
      query: WorkspaceRoutingQuery,
      success: described(TemplatePackFreshness, "Workspace template-pack freshness"),
      error: [ApiSpinosaWorkspaceTargetError, ApiSpinosaFrameworkUnavailableError, ApiSpinosaWorkspaceOperationError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.spinosa.workspace.freshness",
        summary: "Inspect Spinosa workspace template freshness",
        description: "Inspect whether the routed Spinosa workspace matches the installed template pack.",
      }),
    ),
    HttpApiEndpoint.post("update", SpinosaWorkspacePaths.update, {
      query: WorkspaceRoutingQuery,
      success: described(UpdateResult, "Workspace update and post-update freshness"),
      error: [ApiSpinosaWorkspaceTargetError, ApiSpinosaFrameworkUnavailableError, ApiSpinosaWorkspaceOperationError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.spinosa.workspace.update",
        summary: "Update Spinosa workspace template files",
        description:
          "Explicitly refresh the routed Spinosa workspace from the installed template pack and report whether Spinosa must restart.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "spinosaWorkspace",
      description: "Spinosa workspace lifecycle routes.",
    }),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
