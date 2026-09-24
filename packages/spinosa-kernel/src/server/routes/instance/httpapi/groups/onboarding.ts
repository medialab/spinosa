import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const PreviewCounts = Schema.Struct({
  markdown: Schema.Number,
  markitdown: Schema.Number,
  native: Schema.Number,
  binaryCopyable: Schema.Number,
  ocrConvertible: Schema.Number,
  video: Schema.Number,
  audio: Schema.Number,
  unknown: Schema.Number,
  ignored: Schema.Number,
  total: Schema.Number,
})

const PreviewBatch = Schema.Struct({
  ext: Schema.String,
  count: Schema.Number,
  bytes: Schema.Number,
})

const ToolStatus = Schema.Struct({
  markitdown: Schema.Boolean,
  ocr: Schema.Boolean,
  pdfjs: Schema.Boolean,
  canvas: Schema.Boolean,
  ocrUnsupportedReason: Schema.optional(Schema.String),
})

const ToolRepair = Schema.Struct({
  tools: ToolStatus,
  output: Schema.Array(Schema.String),
  exitCode: Schema.Number,
})

const Preview = Schema.Struct({
  sources: Schema.Array(Schema.Struct({
    path: Schema.String,
    counts: PreviewCounts,
    batches: Schema.Array(PreviewBatch),
  })),
  batches: Schema.Array(PreviewBatch),
  suggestedWorkspacePath: Schema.String,
})

const ScanProgress = Schema.Struct({
  status: Schema.Union([Schema.Literal("running"), Schema.Literal("completed"), Schema.Literal("failed"), Schema.Literal("cancelled")]),
  sourceIndex: Schema.Number,
  sourceCount: Schema.Number,
  activeSource: Schema.String,
  activeFile: Schema.optional(Schema.String),
  current: Schema.Number,
  total: Schema.Number,
  error: Schema.optional(Schema.String),
})

const StartPayload = Schema.Struct({
  sourcePaths: Schema.Array(Schema.String),
  workspaceName: Schema.String,
  resumeWorkspacePath: Schema.optional(Schema.String),
  extensions: Schema.Array(Schema.String),
  visionModelId: Schema.String,
  preferredCli: Schema.String,
})

const PreviewPayload = Schema.Struct({
  sourcePaths: Schema.Array(Schema.String),
  scanID: Schema.optional(Schema.String),
})

const JobAction = Schema.Struct({
  action: Schema.Union([
    Schema.Literal("continue"),
    Schema.Literal("background"),
    Schema.Literal("retry"),
    Schema.Literal("changeModel"),
    Schema.Literal("skip"),
    Schema.Literal("abort"),
  ]),
  visionModelId: Schema.optional(Schema.String),
})

const JobFile = Schema.Struct({ relPath: Schema.String, status: Schema.String })
const JobGate = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("phase"), phase: Schema.String, count: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("vision"), relPath: Schema.String, message: Schema.String }),
])
const JobResult = Schema.Struct({
  success: Schema.Boolean,
  imported: Schema.Number,
  recovered: Schema.Number,
  stillMissing: Schema.Number,
  failed: Schema.Number,
})
const JobSnapshot = Schema.Struct({
  id: Schema.String,
  status: Schema.Union([
    Schema.Literal("running"),
    Schema.Literal("waiting"),
    Schema.Literal("completed"),
    Schema.Literal("failed"),
    Schema.Literal("cancelled"),
  ]),
  phase: Schema.String,
  message: Schema.String,
  workspacePath: Schema.optional(Schema.String),
  current: Schema.Number,
  total: Schema.Number,
  activeFile: Schema.optional(Schema.String),
  logs: Schema.Array(Schema.String),
  files: Schema.Array(JobFile),
  gate: Schema.optional(JobGate),
  error: Schema.optional(Schema.String),
  result: Schema.optional(JobResult),
})

const root = "/experimental/onboarding"
export const OnboardingPaths = {
  tools: `${root}/tools`,
  repairTools: `${root}/tools/repair`,
  preview: `${root}/preview`,
  scan: `${root}/scans/:scanID`,
  cancelScan: `${root}/scans/:scanID/cancel`,
  jobs: `${root}/jobs`,
  active: `${root}/active`,
  job: `${root}/jobs/:jobID`,
  action: `${root}/jobs/:jobID/action`,
  cancel: `${root}/jobs/:jobID/cancel`,
} as const

export const OnboardingApi = HttpApi.make("onboarding")
  .add(
    HttpApiGroup.make("onboarding")
      .add(
        HttpApiEndpoint.get("tools", OnboardingPaths.tools, {
          query: WorkspaceRoutingQuery,
          success: described(ToolStatus, "Document-processing tool availability"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(OpenApi.annotations({
          identifier: "onboarding.tools.get",
          summary: "Check document-processing tools",
          description: "Check which bundled document-processing tools are available before scanning sources.",
        })),
        HttpApiEndpoint.post("repairTools", OnboardingPaths.repairTools, {
          query: WorkspaceRoutingQuery,
          success: described(ToolRepair, "Document-processing tool repair result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(OpenApi.annotations({
          identifier: "onboarding.tools.repair",
          summary: "Repair missing document-processing tools",
          description: "Run the bundled framework installer in reinstall mode, then re-check tool availability.",
        })),
        HttpApiEndpoint.post("preview", OnboardingPaths.preview, {
          query: WorkspaceRoutingQuery,
          payload: PreviewPayload,
          success: described(Preview, "Workspace onboarding scan preview"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(OpenApi.annotations({
          identifier: "onboarding.preview",
          summary: "Scan source folders for onboarding",
          description: "Classify importable files, file extensions, and available document-processing tools.",
        })),
        HttpApiEndpoint.get("scan", OnboardingPaths.scan, {
          params: { scanID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(ScanProgress, "Workspace onboarding scan progress"),
          error: HttpApiError.NotFound,
        }).annotateMerge(OpenApi.annotations({
          identifier: "onboarding.scan.get",
          summary: "Read source scan progress",
          description: "Get the active source folder, file, and count while onboarding scans source folders.",
        })),
        HttpApiEndpoint.post("cancelScan", OnboardingPaths.cancelScan, {
          params: { scanID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(ScanProgress, "Cancelled source scan"),
          error: HttpApiError.NotFound,
        }).annotateMerge(OpenApi.annotations({
          identifier: "onboarding.scan.cancel",
          summary: "Cancel a source scan",
          description: "Stop the active source scan before the workspace import begins.",
        })),
        HttpApiEndpoint.post("start", OnboardingPaths.jobs, {
          query: WorkspaceRoutingQuery,
          payload: StartPayload,
          success: described(Schema.Struct({ id: Schema.String, workspacePath: Schema.String }), "Started onboarding job"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(OpenApi.annotations({
          identifier: "onboarding.start",
          summary: "Create and import a Spinosa workspace",
          description: "Run the shared core onboarding workflow as a cancellable background job.",
        })),
        HttpApiEndpoint.get("active", OnboardingPaths.active, {
          query: WorkspaceRoutingQuery,
          success: described(JobSnapshot, "Active onboarding job"),
          error: HttpApiError.NotFound,
        }).annotateMerge(OpenApi.annotations({
          identifier: "onboarding.active.get",
          summary: "Find an active onboarding job",
          description: "Reconnect to an active onboarding import for a source folder.",
        })),
        HttpApiEndpoint.get("job", OnboardingPaths.job, {
          params: { jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(JobSnapshot, "Onboarding job status"),
          error: HttpApiError.NotFound,
        }).annotateMerge(OpenApi.annotations({
          identifier: "onboarding.job.get",
          summary: "Read onboarding progress",
          description: "Get current setup phase, file progress, gate, and final result.",
        })),
        HttpApiEndpoint.post("action", OnboardingPaths.action, {
          params: { jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: JobAction,
          success: described(JobSnapshot, "Updated onboarding job"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(OpenApi.annotations({
          identifier: "onboarding.job.action",
          summary: "Continue or resolve an onboarding phase",
          description: "Continue a phase gate or choose how to resolve a vision transcription failure.",
        })),
        HttpApiEndpoint.post("cancel", OnboardingPaths.cancel, {
          params: { jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(JobSnapshot, "Cancelled onboarding job"),
          error: HttpApiError.NotFound,
        }).annotateMerge(OpenApi.annotations({
          identifier: "onboarding.job.cancel",
          summary: "Cancel workspace onboarding",
          description: "Abort active conversion work and leave the workspace registered for resume.",
        })),
      )
      .annotateMerge(OpenApi.annotations({ title: "onboarding", description: "Spinosa workspace onboarding routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(OpenApi.annotations({
    title: "spinosa onboarding API",
    version: "0.0.1",
    description: "Desktop and client onboarding workflow.",
  }))
