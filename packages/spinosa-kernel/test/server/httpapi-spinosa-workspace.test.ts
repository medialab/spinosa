import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { STARTUP_PROMPT_FALLBACK } from "@spinosa/core/commands/startup"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceRef } from "@/effect/instance-ref"
import { Session } from "@/session/session"
import { SpinosaWorkspaceGroup, SpinosaWorkspacePaths } from "@/server/routes/instance/httpapi/groups/spinosa-workspace"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRouteContext,
  WorkspaceRoutingMiddleware,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { schemaErrorLayer } from "@/server/routes/instance/httpapi/middleware/schema-error"
import { spinosaWorkspaceHandlers } from "@/server/routes/instance/httpapi/handlers/spinosa-workspace"
import { testEffect } from "../lib/effect"

const authorizationLayer = Layer.succeed(
  Authorization,
  Authorization.of((effect) => effect),
)
const workspaceRoutingTestLayer = Layer.succeed(
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingMiddleware.of((effect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const directory = new URL(request.url, "http://localhost").searchParams.get("directory") ?? ""
      return yield* effect.pipe(Effect.provideService(WorkspaceRouteContext, WorkspaceRouteContext.of({ directory })))
    }),
  ),
)
const instanceContextTestLayer = Layer.succeed(
  InstanceContextMiddleware,
  InstanceContextMiddleware.of((effect) =>
    Effect.gen(function* () {
      const route = yield* WorkspaceRouteContext
      const context = {
        directory: route.directory,
        worktree: route.directory,
        project: undefined,
      } as unknown as InstanceContext
      return yield* effect.pipe(Effect.provideService(InstanceRef, context))
    }),
  ),
)

const TestApi = HttpApi.make("spinosa-instance").add(SpinosaWorkspaceGroup)
const routes = HttpApiBuilder.layer(TestApi).pipe(
  Layer.provide(spinosaWorkspaceHandlers),
  Layer.provide([
    authorizationLayer,
    instanceContextTestLayer,
    workspaceRoutingTestLayer,
    schemaErrorLayer,
    Layer.mock(Session.Service)({}),
  ]),
)
const server = HttpRouter.serve(routes, {
  disableListenLog: true,
  disableLogger: true,
}).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
const it = testEffect(server)

function temporaryDirectory(prefix: string) {
  return Effect.acquireRelease(
    Effect.promise(() => mkdtemp(path.join(os.tmpdir(), prefix))),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  )
}

function requestPath(route: string, directory: string) {
  return `${route}?directory=${encodeURIComponent(directory)}`
}

function setTemplateRoot(directory: string) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env.SPINOSA_TEMPLATE_ROOT
      process.env.SPINOSA_TEMPLATE_ROOT = directory
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.SPINOSA_TEMPLATE_ROOT
        else process.env.SPINOSA_TEMPLATE_ROOT = previous
      }),
  )
}

function staleWorkspaceFixture() {
  return Effect.gen(function* () {
    const workspace = yield* temporaryDirectory("spinosa-api-workspace-")
    const framework = yield* temporaryDirectory("spinosa-api-framework-")
    yield* setTemplateRoot(framework)

    const template = path.join(framework, "workspace-template")
    yield* Effect.promise(() => mkdir(path.join(template, ".spinosa"), { recursive: true }))
    yield* Effect.promise(() => mkdir(path.join(framework, "metadata"), { recursive: true }))
    yield* Effect.promise(() => mkdir(path.join(workspace, ".spinosa"), { recursive: true }))
    yield* Effect.promise(() => writeFile(path.join(framework, "metadata", "version"), "2.0.0\n"))
    yield* Effect.promise(() =>
      writeFile(
        path.join(template, ".spinosa", "workspace-files.tsv"),
        "path\trole\tpolicy\nAGENTS.md\tprotocol\treplace_if_unmodified\n",
      ),
    )
    yield* Effect.promise(() => writeFile(path.join(workspace, ".spinosa", "workspace"), "framework_version: 1.0.0\n"))
    yield* Effect.promise(() => writeFile(path.join(template, "AGENTS.md"), "new rules\n"))
    yield* Effect.promise(() => writeFile(path.join(workspace, "AGENTS.md"), "old rules\n"))
    return workspace
  })
}

describe("Spinosa workspace HttpApi", () => {
  it.live("returns the canonical review-first startup payload from the workspace brief", () =>
    Effect.gen(function* () {
      const workspace = yield* staleWorkspaceFixture()
      yield* Effect.promise(() => writeFile(path.join(workspace, "startup-prompt.md"), "Workspace setup brief\n"))

      const response = yield* HttpClient.get(requestPath(SpinosaWorkspacePaths.startupPrompt, workspace))

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({
        input: "Workspace setup brief\n",
        parts: [],
        autoSubmit: false,
        forceAgent: "build",
      })
    }),
  )

  it.live("uses the core startup fallback when the workspace brief is missing", () =>
    Effect.gen(function* () {
      const workspace = yield* temporaryDirectory("spinosa-api-startup-fallback-")
      yield* Effect.promise(() => mkdir(path.join(workspace, ".spinosa"), { recursive: true }))
      yield* Effect.promise(() => writeFile(path.join(workspace, ".spinosa", "workspace"), "framework_version: 1.0.0\n"))

      const response = yield* HttpClient.get(requestPath(SpinosaWorkspacePaths.startupPrompt, workspace))

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({
        input: STARTUP_PROMPT_FALLBACK,
        parts: [],
        autoSubmit: false,
        forceAgent: "build",
      })
    }),
  )

  it.live("inspects freshness for the routed Spinosa workspace", () =>
    Effect.gen(function* () {
      const workspace = yield* staleWorkspaceFixture()

      const response = yield* HttpClient.get(requestPath(SpinosaWorkspacePaths.freshness, workspace))

      expect(response.status).toBe(200)
      expect(yield* response.json).toMatchObject({
        stale: true,
        refreshRecommended: true,
        versionBehind: true,
        stalePaths: ["AGENTS.md"],
        bundledVersion: "2.0.0",
      })
    }),
  )

  it.live("force-updates only on POST and reports freshness, version, and restart requirement", () =>
    Effect.gen(function* () {
      const workspace = yield* staleWorkspaceFixture()

      const freshnessResponse = yield* HttpClient.get(requestPath(SpinosaWorkspacePaths.freshness, workspace))
      expect(freshnessResponse.status).toBe(200)
      expect(yield* freshnessResponse.json).toMatchObject({
        refreshRecommended: true,
      })
      expect(yield* Effect.promise(() => readFile(path.join(workspace, "AGENTS.md"), "utf8"))).toBe("old rules\n")

      const response = yield* HttpClient.post(requestPath(SpinosaWorkspacePaths.update, workspace))
      const result = (yield* response.json) as {
        update: { success: boolean; changes: boolean; updated: number }
        freshness: { refreshRecommended: boolean; workspaceVersion?: string }
        restartRequired: boolean
        restartMessage?: string
      }

      expect(response.status).toBe(200)
      expect(result.update).toMatchObject({
        success: true,
        changes: true,
        updated: 1,
      })
      expect(result.freshness).toMatchObject({
        refreshRecommended: false,
        workspaceVersion: "2.0.0",
      })
      expect(result.restartRequired).toBe(true)
      expect(result.restartMessage).toContain("protocol and agents are not hot-reloaded")
      expect(yield* Effect.promise(() => readFile(path.join(workspace, "AGENTS.md"), "utf8"))).toBe("new rules\n")
      expect(yield* Effect.promise(() => readFile(path.join(workspace, ".spinosa", "workspace"), "utf8"))).toContain(
        "framework_version: 2.0.0",
      )

      const repeated = yield* HttpClient.post(requestPath(SpinosaWorkspacePaths.update, workspace))
      const repeatedResult = (yield* repeated.json) as {
        restartRequired: boolean
      }
      expect(repeatedResult.restartRequired).toBe(false)
    }),
  )

  it.live("rejects a routed directory that is not a Spinosa workspace", () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory("spinosa-api-not-workspace-")
      const response = yield* HttpClient.get(requestPath(SpinosaWorkspacePaths.freshness, directory))

      expect(response.status).toBe(400)
      expect(yield* response.json).toMatchObject({
        name: "SpinosaWorkspaceTargetError",
        data: { message: `Not a Spinosa workspace: ${directory}` },
      })
    }),
  )
})
