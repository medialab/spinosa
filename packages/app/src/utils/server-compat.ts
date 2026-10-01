import type { ServerApi } from "./server"
import { apiKeyInputError, normalizeApiKeyInput } from "@spinosa/kernel-core/util/api-key"
import type { ServerProtocol } from "./server-protocol"
import type {
  AgentPartInput,
  FilePartInput,
  IntegrationInfo,
  LocationInfo,
  ModelV2Info,
  OpencodeClient,
  Session,
  TextPartInput,
} from "@spinosa/sdk/v2/client"
import type { OpencodeClient as GeneratedClient } from "@spinosa/sdk/v2/client"
import { unwrapEnvelope } from "./legacy-api"
import type {
  AgentInfo,
  CommandListOutput,
  IntegrationGetOutput,
  IntegrationListOutput,
  IntegrationMethod,
  IntegrationOauthConnectOutput,
  IntegrationOauthStatusOutput,
  ModelInfo,
  PermissionV2Request,
  Project,
  ProjectCurrent,
  ProviderGetOutput,
  ProviderListOutput,
  ReferenceListOutput,
  SessionApi,
  SessionCommandInput,
  SessionCommandOutput,
  SessionCompactInput,
  SessionCompactOutput,
  SessionInfo,
  SessionMessageInfo,
  SessionPromptInput,
  SessionPromptOutput,
  SessionShellInput,
  SessionShellOutput,
} from "@/utils/legacy-client"

type LegacyClient = OpencodeClient
type LegacyFor = (directory?: string) => LegacyClient
type CompatibleSessionApi = Omit<
  SessionApi,
  "prompt" | "command" | "shell" | "compact" | "rename" | "archive" | "remove"
> & {
  prompt: (input: SessionPromptInput & LegacyPrompt) => Promise<SessionPromptOutput>
  command: (input: SessionCommandInput) => Promise<SessionCommandOutput>
  shell: (input: SessionShellInput & LegacyPrompt) => Promise<SessionShellOutput>
  compact: (input: SessionCompactInput & { model?: LegacyPrompt["model"] }) => Promise<SessionCompactOutput>
  rename: (input: Parameters<SessionApi["rename"]>[0] & LegacyLocation) => ReturnType<SessionApi["rename"]>
  // archive: (input: Parameters<SessionApi["archive"]>[0] & LegacyLocation) => ReturnType<SessionApi["archive"]>
  remove: (input: Parameters<SessionApi["remove"]>[0] & LegacyLocation) => ReturnType<SessionApi["remove"]>
}
type CompatiblePermissionApi = Omit<ServerApi["permission"], "reply"> & {
  reply: (
    input: Parameters<ServerApi["permission"]["reply"]>[0] & { location?: { directory?: string } },
  ) => ReturnType<ServerApi["permission"]["reply"]>
}
export type CompatibleApi = Omit<ServerApi, "session" | "permission"> & {
  readonly session: CompatibleSessionApi
  readonly permission: CompatiblePermissionApi
}
type LegacyPrompt = {
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  legacyParts?: (TextPartInput | FilePartInput | AgentPartInput)[]
}
type LegacyLocation = { directory?: string }
type CompatibleInput = {
  protocol: Promise<ServerProtocol>
  current: ServerApi
  /** Unadapted generated client for explicit V2 namespace mappings. */
  raw: GeneratedClient
  legacy: LegacyFor
  directory?: string
}

function mime(uri: string) {
  const match = /^data:([^;,]+)/.exec(uri)
  return match?.[1] ?? "application/octet-stream"
}

function sessionInfo(session: Session): SessionInfo {
  return {
    id: session.id,
    parentID: session.parentID,
    projectID: session.projectID,
    agent: session.agent,
    model: session.model && {
      id: session.model.id,
      providerID: session.model.providerID,
      variant: session.model.variant,
    },
    cost: session.cost ?? 0,
    tokens: session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: session.time,
    title: session.title,
    location: { directory: session.directory, workspaceID: session.workspaceID },
    subpath: session.path,
    revert: session.revert && {
      messageID: session.revert.messageID,
      partID: session.revert.partID,
      snapshot: session.revert.snapshot,
    },
  }
}

export function createCompatibleApi(input: CompatibleInput): CompatibleApi {
  const v1 = createV1Api(input)
  const v2 = createV2Api(input)
  // Shape reads the V2 facade first (it defines every adapted namespace,
  // including the V2-only `model`/`agent` roots) and falls back to the live
  // client for pass-through namespaces. The adapted V2 client alone cannot
  // serve as the shape: it lacks the legacy `integration` root.
  const shape = new Proxy(v2, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property)
      return Reflect.get(input.current as object, property)
    },
  })
  return lazyApi(
    input.protocol.then((protocol) => (protocol === "v1" ? v1 : v2)),
    shape as unknown as ServerApi,
  )
}

function lazyApi<T extends object>(implementation: Promise<T>, shape: T): T {
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(shape, {
    get(target, property, receiver) {
      const sample = Reflect.get(target, property, receiver)
      if (typeof sample === "function") {
        return (...args: unknown[]) =>
          implementation.then((value) => {
            const method = Reflect.get(value, property)
            if (typeof method !== "function") throw new Error(`API method unavailable: ${String(property)}`)
            return Reflect.apply(method, value, args)
          })
      }
      if (sample === null || typeof sample !== "object") return sample
      if (cache.has(property)) return cache.get(property)
      const nested = lazyApi(
        implementation.then((value) => {
          const result = Reflect.get(value, property)
          if (result === null || typeof result !== "object") {
            throw new Error(`API namespace unavailable: ${String(property)}`)
          }
          return result
        }),
        sample,
      )
      cache.set(property, nested)
      return nested
    },
  })
}

function createV1Api(input: CompatibleInput): CompatibleApi {
  const directory = (location?: { directory?: string }) => location?.directory ?? input.directory
  const legacy = (location?: { directory?: string }) => input.legacy(directory(location))
  const located = <T>(data: T, value?: { directory?: string }) => ({
    location: {
      directory: directory(value) ?? "",
      project: { id: "", directory: directory(value) ?? "" },
    },
    data,
  })

  // Models from the V1 provider catalog (GET /provider carries full models
  // for every provider). Shared by model.list and model.default below.
  const v1models = async (location?: { directory?: string }) => {
    const result = await legacy(location).provider.list({ directory: directory(location) })
    const providers = ((result.data as { all?: V1Provider[] } | undefined)?.all ?? []) as V1CatalogProvider[]
    const data = providers.flatMap((provider) =>
      Object.values(provider.models ?? {}).map((model) => toLegacyV1Model(model, provider.id)),
    )
    return located(data, location)
  }

  return {
    ...input.current,
    session: {
      ...input.current.session,
      async list(
        value?: Parameters<ServerApi["session"]["list"]>[0],
        options?: Parameters<ServerApi["session"]["list"]>[1],
      ) {
        if (!value?.directory && value?.search !== undefined) {
          const result = await legacy().experimental.session.list(
            {
              roots: value.parentID === null ? true : undefined,
              search: value.search,
              limit: value.limit,
            },
            options,
          )
          return { data: (result.data ?? []).map(sessionInfo), cursor: {} }
        }
        const result = await legacy({ directory: value?.directory }).session.list({
          directory: value?.directory,
          roots: value?.parentID === null ? true : undefined,
          search: value?.search,
          limit: value?.limit,
        })
        return { data: (result.data ?? []).map(sessionInfo), cursor: {} }
      },
      async create(value?: Parameters<ServerApi["session"]["create"]>[0]) {
        // Resolve once: the client header and the body directory must agree
        // (V1 Session.list is scoped to the instance's project, so an
        // ambient-bound client creating a body-directory session files it
        // under a project no directory-bound list will ever return).
        const location = value?.location ?? (input.directory ? { directory: input.directory } : undefined)
        const result = await legacy(location).session.create({
          directory: directory(location),
        })
        if (!result.data) throw new Error("Failed to create session")
        return sessionInfo(result.data)
      },
      async get(value: Parameters<ServerApi["session"]["get"]>[0]) {
        const result = await legacy().session.get(value)
        if (!result.data) throw new Error(`Session not found: ${value.sessionID}`)
        return sessionInfo(result.data)
      },
      async active() {
        const result = await legacy().session.status()
        return Object.fromEntries(
          Object.entries(result.data ?? {}).flatMap(([sessionID, status]) =>
            status.type === "idle" ? [] : [[sessionID, { type: "running" as const }]],
          ),
        )
      },
      async rename(value: Parameters<ServerApi["session"]["rename"]>[0] & LegacyLocation) {
        await legacy(value).session.update({ sessionID: value.sessionID, title: value.title })
      },
      // async archive(value: Parameters<ServerApi["session"]["archive"]>[0] & LegacyLocation) {
      //   await legacy(value).session.update({ sessionID: value.sessionID, time: { archived: Date.now() } })
      // },
      async remove(value: Parameters<ServerApi["session"]["remove"]>[0] & LegacyLocation) {
        await legacy(value).session.delete(value)
      },
      async fork(value: Parameters<ServerApi["session"]["fork"]>[0]) {
        const result = await legacy().session.fork(value)
        if (!result.data) throw new Error("Failed to fork session")
        return sessionInfo(result.data)
      },
      async interrupt(value: Parameters<ServerApi["session"]["interrupt"]>[0]) {
        await legacy().session.abort(value)
      },
      async prompt(value: SessionPromptInput & LegacyPrompt) {
        await legacy().session.promptAsync({
          sessionID: value.sessionID,
          messageID: value.id ?? undefined,
          agent: value.agent,
          model: value.model,
          variant: value.variant,
          parts: value.legacyParts ?? [
            { type: "text", text: value.text },
            ...(value.files ?? []).map((file) => ({
              type: "file" as const,
              mime: file.mention ? "text/plain" : mime(file.uri),
              url: file.uri,
              filename: file.name,
              source: file.mention
                ? {
                    type: "file" as const,
                    text: { value: file.mention.text, start: file.mention.start, end: file.mention.end },
                    path: file.uri,
                  }
                : undefined,
            })),
            ...(value.agents ?? []).map((agent) => ({
              type: "agent" as const,
              name: agent.name,
              source: agent.mention
                ? { value: agent.mention.text, start: agent.mention.start, end: agent.mention.end }
                : undefined,
            })),
          ],
        })
        return {
          admittedSeq: 0,
          id: value.id ?? "",
          sessionID: value.sessionID,
          timeCreated: Date.now(),
          type: "user",
          data: { text: value.text },
          delivery: value.delivery ?? "steer",
        }
      },
      async command(value: SessionCommandInput) {
        await legacy().session.command({
          sessionID: value.sessionID,
          messageID: value.id ?? undefined,
          command: value.command,
          arguments: value.arguments ?? "",
          agent: value.agent ?? undefined,
          model: value.model ? `${value.model.providerID}/${value.model.id}` : undefined,
          variant: value.model?.variant,
          parts: value.files?.map((file) => ({
            type: "file" as const,
            mime: mime(file.uri),
            url: file.uri,
            filename: file.name,
          })),
        })
        return {
          admittedSeq: 0,
          id: value.id ?? "",
          sessionID: value.sessionID,
          timeCreated: Date.now(),
          type: "user",
          data: { text: `/${value.command} ${value.arguments ?? ""}`.trim() },
          delivery: value.delivery ?? "steer",
        }
      },
      async shell(value: SessionShellInput & LegacyPrompt) {
        if (!value.agent) throw new Error("An agent is required to run a shell command")
        await legacy().session.shell({
          sessionID: value.sessionID,
          command: value.command,
          agent: value.agent,
          model: value.model,
        })
      },
      compact: async (value: SessionCompactInput & { model?: LegacyPrompt["model"] }) => {
        if (!value.model) throw new Error("A model is required to compact a V1 session")
        await legacy().session.summarize({
          sessionID: value.sessionID,
          providerID: value.model.providerID,
          modelID: value.model.modelID,
        })
        return {
          admittedSeq: 0,
          id: value.id ?? "",
          sessionID: value.sessionID,
          timeCreated: Date.now(),
          type: "compaction",
        }
      },
      revert: {
        stage: async (value: Parameters<ServerApi["session"]["revert"]["stage"]>[0]) => {
          await legacy().session.revert(value)
          return { messageID: value.messageID }
        },
        clear: async (value: Parameters<ServerApi["session"]["revert"]["clear"]>[0]) => {
          await legacy().session.unrevert(value)
        },
        commit: input.current.session.revert.commit,
      },
      async message(value: Parameters<ServerApi["session"]["message"]>[0]) {
        // V1 single-message read (GET /session/:id/message/:messageID), the
        // same projection server-session's V1 fetchMessage path consumes.
        const result = await legacy().session.message({ sessionID: value.sessionID, messageID: value.messageID })
        return result.data as unknown as SessionMessageInfo
      },
    },
    project: {
      ...input.current.project,
      async list() {
        return ((await legacy().project.list()).data ?? []) as Project[]
      },
      async current(value?: Parameters<ServerApi["project"]["current"]>[0]) {
        const result = await legacy(value?.location).project.current()
        if (!result.data) throw new Error("Project not found")
        return { id: result.data.id, directory: result.data.worktree } satisfies ProjectCurrent
      },
      // async update(value: Parameters<ServerApi["project"]["update"]>[0]) {
      //   const project = (await legacy().project.list()).data?.find((item) => item.id === value.projectID)
      //   const result = await legacy({ directory: project?.worktree }).project.update({
      //     ...value,
      //     directory: project?.worktree,
      //   })
      //   if (!result.data) throw new Error(`Project not found: ${value.projectID}`)
      //   return result.data as Project
      // },
      async directories(value: Parameters<ServerApi["project"]["directories"]>[0]) {
        const result = await legacy(value.location).worktree.list()
        return (result.data ?? []).map((item) => ({ directory: item }))
      },
    },
    // path: {
    //   ...input.current.path,
    //   async get(value?: Parameters<ServerApi["path"]["get"]>[0]) {
    //     const result = await legacy(value?.location).path.get()
    //     if (!result.data) throw new Error("Path unavailable")
    //     return result.data
    //   },
    // },
    vcs: {
      ...input.current.vcs,
      // async get(value?: Parameters<ServerApi["vcs"]["get"]>[0]) {
      //   const result = await legacy(value?.location).vcs.get()
      //   return located({ branch: result.data?.branch, defaultBranch: result.data?.default_branch }, value?.location)
      // },
      async status(value?: Parameters<ServerApi["vcs"]["status"]>[0]) {
        const result = await legacy(value?.location).vcs.status()
        const data = result.data && "files" in result.data ? result.data.files : []
        return located(data, value?.location)
      },
      async diff(value: Parameters<ServerApi["vcs"]["diff"]>[0]) {
        const result = await legacy(value.location).vcs.diff({
          mode: value.mode === "working" ? "git" : value.mode,
          context: value.context,
        })
        const files = result.data && "files" in result.data ? result.data.files : []
        return located(
          files.map((file) => ({
            file: file.file,
            patch: file.patch ?? "",
            additions: file.additions,
            deletions: file.deletions,
            status: file.status ?? "modified",
          })),
          value.location,
        )
      },
    },
    file: {
      ...input.current.file,
      async list(value?: Parameters<ServerApi["file"]["list"]>[0]) {
        const result = await legacy(value?.location).file.list({ path: value?.path ?? "" })
        return located(result.data ?? [], value?.location)
      },
      async find(value: Parameters<ServerApi["file"]["find"]>[0]) {
        const result = await legacy(value.location).find.files({
          query: value.query,
          dirs: value.type === undefined ? undefined : value.type === "directory" ? "true" : "false",
          limit: value.limit,
        })
        return located(
          (result.data ?? []).map((path) => ({ path, type: value.type ?? "file" })),
          value.location,
        )
      },
    },
    integration: {
      // The Spinosa V2 client exposes integrations under `.v2`; the legacy
      // root is absent, so spread defensively. The app only calls the
      // overridden get/connect/oauth methods below.
      ...(input.current.integration ?? {}),
      async list(value): Promise<IntegrationListOutput> {
        const location = value?.location?.directory ?? input.directory
        return unwrapEnvelope(
          await input.raw.v2.integration.list(location ? { location: { directory: location } } : undefined),
        ) as IntegrationListOutput
      },
      async get(value: Parameters<ServerApi["integration"]["get"]>[0]) {
        const methods = ((await legacy(value.location).provider.auth()).data?.[value.integrationID] ?? []).map(
          (method, index) =>
            method.type === "api"
              ? { type: "key" as const, label: method.label }
              : { type: "oauth" as const, id: String(index), label: method.label, prompts: method.prompts },
        )
        return located(
          {
            id: value.integrationID,
            name: value.integrationID,
            methods,
            connections: [],
          },
          value.location,
        )
      },
      connect: {
        ...(input.current.integration?.connect ?? {}),
        key: async (value: Parameters<ServerApi["integration"]["connect"]["key"]>[0]) => {
          if (apiKeyInputError(value.key)) throw new Error("Invalid API key")
          await legacy(value.location).auth.set({
            providerID: value.integrationID,
            auth: { type: "api", key: normalizeApiKeyInput(value.key) },
          })
          await legacy(value.location).instance.dispose()
          await input.legacy().instance.dispose()
        },
      },
      oauth: {
        ...(input.current.integration?.oauth ?? {}),
        connect: async (value: Parameters<ServerApi["integration"]["oauth"]["connect"]>[0]) => {
          const method = Number(value.methodID)
          const result = await legacy(value.location).provider.oauth.authorize(
            { providerID: value.integrationID, method, inputs: value.inputs },
            { throwOnError: true },
          )
          if (!result.data) throw new Error("Failed to start OAuth authorization")
          return located(
            {
              attemptID: `${value.integrationID}:${method}`,
              url: result.data.url,
              instructions: result.data.instructions,
              mode: result.data.method,
              time: { created: Date.now(), expires: Date.now() + 10 * 60 * 1000 },
            },
            value.location,
          )
        },
        complete: async (value: Parameters<ServerApi["integration"]["oauth"]["complete"]>[0]) => {
          const method = Number(value.attemptID.split(":").at(-1))
          await legacy(value.location).provider.oauth.callback(
            { providerID: value.integrationID, method, code: value.code },
            { throwOnError: true },
          )
          await legacy(value.location).instance.dispose()
          await input.legacy().instance.dispose()
        },
        status: async (value: Parameters<ServerApi["integration"]["oauth"]["status"]>[0]) => {
          const method = Number(value.attemptID.split(":").at(-1))
          await legacy(value.location).provider.oauth.callback(
            { providerID: value.integrationID, method },
            { throwOnError: true },
          )
          await legacy(value.location).instance.dispose()
          await input.legacy().instance.dispose()
          return located(
            { status: "complete" as const, time: { created: Date.now(), expires: Date.now() } },
            value.location,
          )
        },
        cancel: async (value: Parameters<ServerApi["integration"]["oauth"]["cancel"]>[0]) => {
          // V1 oauth attempts (v1:{id}:{method}) complete inline; only V2
          // attempt IDs need explicit cancellation on the server.
          if (value.attemptID.startsWith("v1:")) return
          const location = value.location?.directory ?? input.directory
          await input.raw.v2.integration.attempt.cancel({
            attemptID: value.attemptID,
            ...(location ? { location: { directory: location } } : {}),
          })
        },
      },
    },
    pty: {
      ...input.current.pty,
      // async shells(value?: Parameters<ServerApi["pty"]["shells"]>[0]) {
      //   return located((await legacy(value?.location).pty.shells()).data ?? [], value?.location)
      // },
      async list(value?: Parameters<ServerApi["pty"]["list"]>[0]) {
        return located((await legacy(value?.location).pty.list()).data ?? [], value?.location)
      },
      async create(value?: Parameters<ServerApi["pty"]["create"]>[0]) {
        const result = await legacy(value?.location).pty.create({
          // Explicit query directory: non-GET instance routes must not rely
          // on header-only transport (stripped by some fetch wrappers).
          directory: directory(value?.location),
          command: value?.command,
          args: value?.args ? [...value.args] : undefined,
          cwd: value?.cwd,
          title: value?.title,
          env: value?.env,
        })
        if (!result.data) throw new Error("Failed to create terminal")
        return located(result.data, value?.location)
      },
      async get(value: Parameters<ServerApi["pty"]["get"]>[0]) {
        const result = await legacy(value.location).pty.get({
          ptyID: value.ptyID,
          directory: directory(value.location),
        })
        if (!result.data) throw new Error(`Terminal not found: ${value.ptyID}`)
        return located(result.data, value.location)
      },
      async update(value: Parameters<ServerApi["pty"]["update"]>[0]) {
        const result = await legacy(value.location).pty.update({
          ptyID: value.ptyID,
          directory: directory(value.location),
          title: value.title,
          size: value.size,
        })
        if (!result.data) throw new Error(`Terminal not found: ${value.ptyID}`)
        return located(result.data, value.location)
      },
      async remove(value: Parameters<ServerApi["pty"]["remove"]>[0]) {
        await legacy(value.location).pty.remove({ ptyID: value.ptyID, directory: directory(value.location) })
      },
      // async connectToken(value: Parameters<ServerApi["pty"]["connectToken"]>[0]) {
      //   const result = await legacy(value.location).pty.connectToken({ ptyID: value.ptyID })
      //   if (!result.data) throw new Error(`Failed to connect terminal: ${value.ptyID}`)
      //   return located(result.data, value.location)
      // },
    },
    permission: {
      ...input.current.permission,
      request: {
        async list(value?: Parameters<ServerApi["permission"]["request"]["list"]>[0]) {
          // The generated root client exposes a flat permission.list
          // returning a bare array; the app consumes request.list with the
          // legacy {location, data} envelope (bootstrap permission warmup).
          const result = await legacy(value?.location).permission.list({
            directory: directory(value?.location),
          })
          // Passthrough: every consumer normalizes immediately
          // (normalizePermissionRequest accepts the SDK flat shape).
          return located((result.data ?? []) as unknown as PermissionV2Request[], value?.location)
        },
      },
      async reply(value: Parameters<ServerApi["permission"]["reply"]>[0] & { location?: { directory?: string } }) {
        await legacy(value.location).permission.respond({
          sessionID: value.sessionID,
          permissionID: value.requestID,
          response: value.reply,
          directory: directory(value.location),
        })
      },
    },
    question: {
      ...input.current.question,
      request: {
        async list(value?: Parameters<ServerApi["question"]["request"]["list"]>[0]) {
          const result = await legacy(value?.location).question.list({
            directory: directory(value?.location),
          })
          return located(result.data ?? [], value?.location)
        },
      },
      async reply(value: Parameters<ServerApi["question"]["reply"]>[0]) {
        await legacy().question.reply({
          requestID: value.requestID,
          answers: value.answers.map((answer) => [...answer]),
        })
      },
      async reject(value: Parameters<ServerApi["question"]["reject"]>[0]) {
        await legacy().question.reject({ requestID: value.requestID })
      },
    },
    // The namespaces below complete the V1 facade. The shape proxy in
    // createCompatibleApi advertises every namespace the V2 facade defines,
    // so each one must also resolve under v1 — otherwise merely accessing
    // api.provider/api.message/... schedules an unhandled rejection against
    // the v1 implementation. Reads prefer the V1 tree (the same transport as
    // V1 prompt submission); only endpoints with no V1 equivalent call the
    // served V2 roots directly.
    provider: {
      async list(value): Promise<ProviderListOutput> {
        const result = await legacy(value?.location).provider.list({
          directory: directory(value?.location),
        })
        const data = ((result.data as { all?: V1Provider[] } | undefined)?.all ?? []) as V1Provider[]
        return located(data.map(toLegacyCatalogProvider), value?.location)
      },
      async get(value): Promise<ProviderGetOutput> {
        const result = await legacy(value?.location).provider.list({
          directory: directory(value?.location),
        })
        const found = (((result.data as { all?: V1Provider[] } | undefined)?.all ?? []) as V1Provider[]).find(
          (item) => item.id === value.providerID,
        )
        if (!found) throw new Error(`Provider not found: ${value.providerID}`)
        return located(toLegacyCatalogProvider(found), value?.location)
      },
    },
    model: {
      async list(value) {
        return v1models(value?.location)
      },
      async default(value) {
        // No V1 default-model endpoint exists: honor config.model and report
        // null otherwise (same contract as the V2 mapping); consumers fall
        // back to the first available model per provider.
        const loc = value?.location?.directory ?? input.directory
        const config = unwrapEnvelope(await input.raw.config.get(loc ? { directory: loc } : undefined)) as {
          model?: string
        }
        const [providerID, ...rest] = (config.model ?? "").split("/")
        const modelID = rest.join("/")
        if (!providerID || !modelID) return located(null, value?.location)
        const body = await v1models(value?.location)
        const match = body.data.find((item) => item.providerID === providerID && item.id === modelID)
        if (!match) return { location: body.location, data: null }
        return { location: body.location, data: match }
      },
    },
    agent: {
      async list(value) {
        // Same served set as the V2 mapping (verified identical membership
        // against GET /agent); projected to the legacy agent shape here so
        // the namespace resolves under v1 too.
        const body = unwrapEnvelope(
          await input.raw.v2.agent.list(
            value?.location ? { location: value.location } : input.directory ? { location: { directory: input.directory } } : undefined,
          ),
        ) as {
          location: LocationInfo
          data: Array<Parameters<typeof toLegacyAgent>[0]>
        }
        return { location: body.location, data: body.data.map(toLegacyAgent) }
      },
    },
    message: {
      async list(value) {
        // V1 projection (GET /session/:id/message), the same source the TUI
        // reads. `cursor` is accepted for call-shape compatibility and used
        // as the V1 `before` bound; `order` has no V1 equivalent
        // (newest-first). The empty cursor terminates page walkers: V1 reads
        // return the full projection, not pages.
        const result = await legacy().session.messages({
          sessionID: value.sessionID,
          limit: value.limit,
          before: (value as { before?: string }).before ?? value.cursor ?? undefined,
        })
        return {
          data: (result.data ?? []) as unknown as SessionMessageInfo[],
          cursor: { previous: null, next: null },
        }
      },
    },
    command: {
      async list(value) {
        // The V1 command tree serves legacy-shaped items (model as
        // "provider/model"), matching what loadCommands splits.
        const result = await legacy(value?.location).command.list({
          directory: directory(value?.location),
        })
        const data = (result.data ?? []).map((command) => {
          const source = (command as typeof command & { source?: "command" | "mcp" | "skill" }).source
          return {
            name: command.name,
            template: command.template,
            description: command.description,
            agent: command.agent,
            model: command.model as unknown as CommandListOutput["data"][number]["model"],
            subtask: command.subtask,
            ...(source ? { source } : {}),
          }
        })
        return located(data, value?.location)
      },
    },
    reference: {
      async list(value): Promise<ReferenceListOutput> {
        // No V1 reference endpoint exists; V2 items are structurally
        // identical to the legacy ones.
        return unwrapEnvelope(
          await input.raw.v2.reference.list(value?.location ? { location: value.location } : undefined),
        ) as ReferenceListOutput
      },
    },
    mcp: {
      async list(value) {
        const result = await legacy(value?.location).mcp.status({
          directory: directory(value?.location),
        })
        const data = result.data ?? {}
        return located(
          Object.entries(data).map(([name, status]) => ({ name, status })),
          value?.location,
        )
      },
      async add(value) {
        if (!value.config) throw new Error("MCP server configuration is required")
        await legacy(value?.location).mcp.add({
          name: value.server,
          config: value.config as { type: "local"; command: string[] } | { type: "remote"; url: string },
          directory: directory(value?.location),
        })
      },
      async remove(value) {
        // No V1 remove-server endpoint exists (servers are disconnected via
        // disconnect and edited out of config); fail loudly instead of
        // dangling like the pre-completion facade did.
        throw new Error(`MCP server removal is not supported by the V1 API: ${value.server}`)
      },
      async connect(value) {
        await legacy(value?.location).mcp.connect({
          name: value.server,
          directory: directory(value?.location),
        })
      },
      async disconnect(value) {
        await legacy(value?.location).mcp.disconnect({
          name: value.server,
          directory: directory(value?.location),
        })
      },
      resource: {
        async catalog(value) {
          const resources = await fetchResourceCatalog(input.raw, directory(value?.location) || undefined)
          return located({ resources, templates: [] }, value?.location)
        },
      },
    },
  }
}

type V2Location = { directory?: string; workspace?: string }

// Shared endpoint mappings used by both facades. Every mapping below is
// plain HTTP against served endpoints (V1 tree or served V2 roots), so the
// behavior is identical regardless of which protocol selected the facade.
// The V1 facade prefers V1-tree reads for conversation state (session,
// message, agent) to stay on the same transport as V1 prompt submission;
// mappings with no V1 equivalent (reference, integration list) call the
// served V2 endpoints directly.
function sharedMappings(input: CompatibleInput) {
  const directoryOf = (location?: V2Location) => location?.directory ?? input.directory ?? ""
  const located = <T>(data: T, location?: V2Location) => ({
    location: {
      directory: directoryOf(location),
      project: { id: "", directory: directoryOf(location) },
    },
    data,
  })
  const at = (location?: V2Location) => {
    const directory = location?.directory ?? input.directory
    if (!directory && !location?.workspace) return undefined
    return { location: { directory, workspace: location?.workspace } }
  }
  const root = (location?: V2Location) => input.legacy(directoryOf(location))
  const flat = (location?: V2Location) => {
    const directory = directoryOf(location) || undefined
    return { directory, workspace: location?.workspace }
  }
  // Preserve every adapted pass-through method of a namespace while
  // replacing selected methods with explicit mappings. Missing roots
  // (model/agent/reference have no V1 namespace) start from empty.
  const override = <T extends object>(namespace: T | undefined, methods: Partial<T>): T =>
    new Proxy((namespace ?? {}) as T, {
      get(target, property, receiver) {
        if (property in methods) return methods[property as keyof T]
        return Reflect.get(target, property, receiver)
      },
    })
  // V1 methods for one provider, or [] when the endpoint fails. Used to merge
  // oauth methods the V2 integration registry does not carry (copilot, gitlab,
  // poe, xai, azure, ... — see desktop-parity-audit).
  const v1AuthMethods = async (location: V2Location | undefined, integrationID: string) => {
    try {
      const methods = (await root(location).provider.auth()).data as Record<string, V1AuthMethod[]> | undefined
      return methods?.[integrationID] ?? []
    } catch {
      return []
    }
  }
  // Models from the V1 catalog (GET /provider carries full models for every
  // provider). Falls back to V2 /api/model when the V1 catalog yields none.
  const v1CatalogModels = async (location: V2Location | undefined) => {
    const result = await root(location).provider.list(flat(location))
    const providers = ((result.data as { all?: V1CatalogProvider[] } | undefined)?.all ?? []) as V1CatalogProvider[]
    return providers.flatMap((provider) =>
      Object.values(provider.models ?? {}).map((model) => toLegacyV1Model(model, provider.id)),
    )
  }
  const v2ModelList = async (
    location: V2Location | undefined,
  ): Promise<{ location: LocationInfo; data: ModelInfo[] }> => {
    const body = unwrapEnvelope(await input.raw.v2.model.list(at(location))) as {
      location: LocationInfo
      data: Array<ModelV2Info>
    }
    return { location: body.location, data: body.data.map(toLegacyModel) }
  }
  const v1OrV2Models = async (location: V2Location | undefined): Promise<{ location: LocationInfo; data: ModelInfo[] }> => {
    try {
      const models = await v1CatalogModels(location)
      if (models.length > 0) {
        return {
          location: {
            directory: directoryOf(location),
            project: { id: "", directory: directoryOf(location) },
          },
          data: models,
        }
      }
    } catch {
      // fall through to V2
    }
    return v2ModelList(location)
  }
  return { directoryOf, located, at, root, flat, override, v1AuthMethods, v1CatalogModels, v2ModelList, v1OrV2Models }
}

type SharedMappings = ReturnType<typeof sharedMappings>

type RawLowClient = {
  get: (options: Record<string, unknown>) => Promise<unknown>
}

// The generated client was not regenerated for some served endpoints
// (GET /config/providers, GET /experimental/resource). This reaches the
// shared low-level hey-api client owned by the generated root instance:
// same fetch, auth headers, and location interceptors. Covered by contract
// tests; prefer generated methods wherever they exist.
function lowClientOf(raw: GeneratedClient): RawLowClient {
  const holder = raw as unknown as { client?: RawLowClient }
  const client = holder.client
  if (!client || typeof client.get !== "function") throw new Error("API unavailable: low-level client")
  return client
}

function directoryHeaders(directory?: string): Record<string, Record<string, string>> {
  if (!directory) return {}
  return { headers: { "x-spinosa-directory": encodeURIComponent(directory) } }
}

/** Provider IDs available to the V1 session runner (GET /config/providers). */
export async function fetchV1ActiveProviderIDs(raw: GeneratedClient, directory?: string): Promise<Array<string>> {
  const client = lowClientOf(raw)
  const headers = directoryHeaders(directory)
  const config = (await unwrapEnvelope(await client.get({ url: "/config/providers", ...headers }))) as {
    providers?: Array<{ id: string }>
  }
  return (config?.providers ?? []).map((provider) => provider.id)
}

/**
 * Active provider IDs across both credential universes. Keep this for callers
 * that need to display every stored connection; model execution must use
 * fetchV1ActiveProviderIDs until the kernel bridges V2 credentials.
 */
export async function fetchActiveProviderIDs(raw: GeneratedClient, directory?: string): Promise<Array<string>> {
  const client = lowClientOf(raw)
  const headers = directoryHeaders(directory)
  const v1 = await fetchV1ActiveProviderIDs(raw, directory)
  const integrations = await client
    .get({ url: "/api/integration", ...headers })
    .then((response) => unwrapEnvelope(response) as { data?: Array<{ id: string; connections?: unknown[] }> })
    .then((body) =>
      (body?.data ?? [])
        .filter((item) => Array.isArray(item.connections) && item.connections.length > 0)
        .map((item) => item.id),
    )
    .catch(() => [] as string[])
  return [...new Set([...v1, ...integrations])]
}

/** Remove stored V2 credentials for a provider; environment connections stay untouched. */
export async function clearV2ProviderCredentials(
  raw: GeneratedClient,
  providerID: string,
  directory?: string,
): Promise<void> {
  const location = directory ? { directory } : undefined
  const result = unwrapEnvelope(
    await raw.v2.integration.get({ integrationID: providerID, location }),
  ) as { data?: IntegrationInfo }
  const credentials = (result.data?.connections ?? []).filter(
    (connection): connection is Extract<IntegrationInfo["connections"][number], { type: "credential" }> =>
      connection.type === "credential",
  )
  await Promise.all(
    credentials.map((connection) => raw.v2.credential.remove({ credentialID: connection.id, location })),
  )
}

type CatalogResource = {
  client?: string
  name?: string
  uri?: string
  description?: string
  mimeType?: string
}

/** MCP resource catalog from the served experimental endpoint. */
export async function fetchResourceCatalog(raw: GeneratedClient, directory?: string) {
  const experimental = raw.experimental as unknown as {
    resource?: { list: (params: unknown, options?: unknown) => Promise<unknown> }
  }
  const body = (await (typeof experimental.resource?.list === "function"
    ? unwrapEnvelope(
        await experimental.resource.list(
          directory ? { directory } : undefined,
          directory ? directoryHeaders(directory) : undefined,
        ),
      )
    : unwrapEnvelope(
        await lowClientOf(raw).get({ url: "/experimental/resource", ...directoryHeaders(directory) }),
      ))) as Record<string, CatalogResource>
  return Object.entries(body ?? {}).map(([key, item]) => ({
    server: item.client ?? key,
    name: item.name ?? key,
    uri: item.uri ?? key,
    description: item.description,
    mimeType: item.mimeType,
  }))
}

// The vendored legacy ProviderV2Info is the old flat opencode shape
// ({package, settings, headers, body} top-level). The catalog MUST come from
// the V1 root list: the V2 list returns active (connected) providers only,
// which would hide every unconnected provider from the connect dialog.
// Normalize keeps reading the flat fields, so the facade converts.
type V1Provider = {
  id: string
  name: string
  options: Record<string, unknown>
}

function toLegacyCatalogProvider(provider: V1Provider): ProviderListOutput["data"][number] {
  return {
    id: provider.id,
    name: provider.name,
    package: "",
    settings: provider.options as ProviderListOutput["data"][number]["settings"],
  }
}

function toLegacyModel(model: ModelV2Info): ModelInfo {
  const api = model.api.type === "aisdk" ? model.api : undefined
  return {
    id: model.id,
    modelID: model.id,
    providerID: model.providerID,
    family: model.family,
    name: model.name,
    compatibility: undefined,
    package: api?.package,
    settings: api?.settings as ModelInfo["settings"],
    headers: model.request.headers,
    body: model.request.body as ModelInfo["body"],
    capabilities: model.capabilities,
    variants: model.variants.map((variant) => ({ id: variant.id })),
    time: model.time,
    cost: model.cost,
    status: model.status,
    enabled: model.enabled,
    limit: model.limit,
  }
}

/** V1 catalog model as served by GET /provider (kernel Provider.Model). */
type V1CatalogModel = {
  id: string
  providerID?: string
  name?: string
  family?: string
  api?: { id?: string; url?: string; npm?: string }
  capabilities?: {
    toolcall?: boolean
    input?: Record<string, boolean>
    output?: Record<string, boolean>
  }
  cost?: { input?: number; output?: number; cache?: { read?: number; write?: number } }
  limit?: { context?: number; input?: number; output?: number }
  status?: string
  options?: Record<string, unknown>
  headers?: Record<string, string>
  release_date?: string
  variants?: Record<string, Record<string, unknown>>
}

type V1CatalogProvider = {
  id: string
  models?: Record<string, V1CatalogModel>
}

const modalityList = (value?: Record<string, boolean>) =>
  Object.entries(value ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)

/** Maps a V1 catalog model to the legacy ModelInfo contract. */
function toLegacyV1Model(model: V1CatalogModel, providerID: string): ModelInfo {
  const released = Date.parse(model.release_date ?? "")
  return {
    id: model.id,
    modelID: model.id,
    providerID: model.providerID ?? providerID,
    family: model.family,
    name: model.name ?? model.id,
    package: model.api?.npm,
    settings: model.options as ModelInfo["settings"],
    headers: model.headers,
    capabilities: {
      tools: model.capabilities?.toolcall ?? false,
      input: modalityList(model.capabilities?.input),
      output: modalityList(model.capabilities?.output),
    },
    variants: Object.entries(model.variants ?? {}).map(([id, settings]) => ({
      id,
      settings: settings as ModelInfo["variants"][number]["settings"],
    })),
    time: { released: Number.isFinite(released) ? released : 0 },
    cost: [
      {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cache: { read: model.cost?.cache?.read ?? 0, write: model.cost?.cache?.write ?? 0 },
      },
    ],
    status: (model.status ?? "active") as ModelInfo["status"],
    enabled: true,
    limit: {
      context: model.limit?.context ?? 0,
      input: model.limit?.input,
      output: model.limit?.output ?? 0,
    },
  }
}

type V1AuthMethod = {
  type: "oauth" | "api"
  label: string
  prompts?: Extract<IntegrationMethod, { type: "oauth" }>["prompts"]
}

/**
 * Merges V1 provider.auth methods into the V2 integration methods. V1 oauth
 * methods get `v1:{index}` ids (routed to auth.json — the universe the V1
 * session LLM reads) and win label duplicates against V2 oauth methods; V1
 * api methods are dropped when a V2 key method exists.
 */
function mergeIntegrationMethods(v2Methods: IntegrationMethod[], v1Methods: V1AuthMethod[]): IntegrationMethod[] {
  const merged: IntegrationMethod[] = [...v2Methods]
  v1Methods.forEach((method, index) => {
    if (method.type === "api") {
      if (merged.some((entry) => entry.type === "key")) return
      merged.push({ type: "key", label: method.label })
      return
    }
    const entry: IntegrationMethod = {
      type: "oauth",
      id: `v1:${index}`,
      label: method.label,
      prompts: method.prompts,
    }
    const duplicate = merged.findIndex((value) => value.type === "oauth" && value.label === method.label)
    if (duplicate >= 0) merged[duplicate] = entry
    else merged.push(entry)
  })
  return merged
}

function toLegacyAgent(agent: { id: string } & Omit<AgentInfo, "id" | "name">): AgentInfo {
  return { ...agent, name: agent.id }
}

/**
 * V2 facade over the same Spinosa kernel.
 *
 * The V1 shim above stays for every namespace whose legacy shape is served
 * by the kernel's V1 tree (session, project, file, pty, permission,
 * question, ...): those implementations are plain HTTP calls and therefore
 * protocol-independent. Namespaces absent from the generated root client
 * (`integration`, `model`, `agent`, `message`) or whose legacy contract is
 * V2-native (`provider`, `command`, `reference`, `mcp`, `session.message`)
 * are mapped explicitly to the generated `.v2` methods with forwarding
 * receivers (never through the adapting proxy: spreading or re-calling
 * proxied class instances loses the prototype receiver and risks
 * double-unwrapping domain payloads).
 */
function createV2Api(input: CompatibleInput): CompatibleApi {
  const base = createV1Api(input)
  const v2 = input.raw.v2
  const { directoryOf, located, at, root, flat, override, v1AuthMethods, v1CatalogModels, v2ModelList, v1OrV2Models } =
    sharedMappings(input)

  return {
    ...base,
    provider: override(input.current.provider, {
      async list(value): Promise<ProviderListOutput> {
        const result = await root(value?.location).provider.list(flat(value?.location))
        const data = result.data?.all ?? []
        return located(data.map(toLegacyCatalogProvider), value?.location)
      },
      async get(value): Promise<ProviderGetOutput> {
        const result = await root(value?.location).provider.list(flat(value?.location))
        const found = (result.data?.all ?? []).find((item) => item.id === value.providerID)
        if (!found) throw new Error(`Provider not found: ${value.providerID}`)
        return located(toLegacyCatalogProvider(found), value?.location)
      },
    }),
    model: override({} as ServerApi["model"], {
      async list(value) {
        return v1OrV2Models(value?.location)
      },
      async default(value) {
        // No V2 default-model endpoint exists. The TUI resolves launch >
        // selected > agent > config.model > recent > provider default, so the
        // facade honors config.model and reports null otherwise; consumers
        // fall back to the first available model per provider.
        const config = unwrapEnvelope(await input.raw.config.get(flat(value?.location))) as {
          model?: string
        }
        const [providerID, ...rest] = (config.model ?? "").split("/")
        const modelID = rest.join("/")
        if (!providerID || !modelID) return located(null, value?.location)
        const body = await v1OrV2Models(value?.location)
        const match = body.data.find((item) => item.providerID === providerID && item.id === modelID)
        if (!match) return { location: body.location, data: null }
        return { location: body.location, data: match }
      },
    }),
    agent: override({} as ServerApi["agent"], {
      async list(value) {
        const body = unwrapEnvelope(await v2.agent.list(at(value?.location))) as {
          location: LocationInfo
          data: Array<Parameters<typeof toLegacyAgent>[0]>
        }
        return { location: body.location, data: body.data.map(toLegacyAgent) }
      },
    }),
    session: override(base.session, {
      async message(value) {
        // V2 projected single message: server-session's V2 paths
        // (fetchMessage, hydrateV2Message) feed it to
        // normalizeSessionMessages/projectV2, which consume the projected
        // SessionMessageInfo shape — not the V1-root single-message union.
        const body = unwrapEnvelope(
          await v2.session.message({ sessionID: value.sessionID, messageID: value.messageID }),
        ) as { data: SessionMessageInfo }
        return body.data
      },
    }),
    message: override({} as ServerApi["message"], {
      async list(value) {
        // V2 projected pages ({data, cursor}) for server-session's V2
        // fetchMessages; the generated root client has no top-level
        // `message` namespace, so without this mapping `api.message` is
        // undefined and the V2 branches stay dormant. V2 session lookup is
        // global: no directory/location wrapper is sent.
        return unwrapEnvelope(
          await v2.session.messages({
            sessionID: value.sessionID,
            limit: value.limit,
            order: value.order,
            cursor: value.cursor ?? undefined,
          }),
        ) as Awaited<ReturnType<ServerApi["message"]["list"]>>
      },
    }),
    integration: override(base.integration, {
      async list(value): Promise<IntegrationListOutput> {
        return unwrapEnvelope(await v2.integration.list(at(value?.location))) as IntegrationListOutput
      },
      async get(value): Promise<IntegrationGetOutput> {
        const [result, v1Methods] = await Promise.all([
          v2.integration.get({ integrationID: value.integrationID, ...at(value?.location) }).then((response) =>
            unwrapEnvelope(response),
          ) as Promise<IntegrationGetOutput>,
          v1AuthMethods(value.location, value.integrationID),
        ])
        if (!result.data) return result
        return { ...result, data: { ...result.data, methods: mergeIntegrationMethods(result.data.methods, v1Methods) } }
      },
      connect: {
        key: async (value) => {
          if (apiKeyInputError(value.key)) throw new Error("Invalid API key")
          const key = normalizeApiKeyInput(value.key)
          // Dual-write: V2 first (surfaces missing-integration 400 before
          // touching auth.json), then V1 auth.set so the session LLM and
          // /config/providers see the key. Awaited; retry is idempotent. No
          // dispose — Spinosa's authSet handler reloads providers.
          await v2.integration.connect.key({
            integrationID: value.integrationID,
            key,
            label: value.label,
            ...at(value?.location),
          }, { throwOnError: true })
          await root(value.location).auth.set({
            providerID: value.integrationID,
            auth: { type: "api", key },
          })
        },
      },
      oauth: {
        connect: async (value): Promise<IntegrationOauthConnectOutput> => {
          if (value.methodID.startsWith("v1:")) {
            const method = Number(value.methodID.slice("v1:".length))
            const result = await root(value.location).provider.oauth.authorize(
              { providerID: value.integrationID, method, inputs: value.inputs },
              { throwOnError: true },
            )
            if (!result.data) throw new Error("Failed to start OAuth authorization")
            return located(
              {
                attemptID: `v1:${value.integrationID}:${method}`,
                url: result.data.url,
                instructions: result.data.instructions,
                mode: result.data.method,
                time: { created: Date.now(), expires: Date.now() + 10 * 60 * 1000 },
              },
              value.location,
            )
          }
          return unwrapEnvelope(
            await v2.integration.connect.oauth({
              integrationID: value.integrationID,
              methodID: value.methodID,
              inputs: value.inputs ?? {},
              label: value.label,
              ...at(value?.location),
            }),
          ) as IntegrationOauthConnectOutput
        },
        status: async (value): Promise<IntegrationOauthStatusOutput> => {
          if (value.attemptID.startsWith("v1:")) {
            const method = Number(value.attemptID.split(":").at(-1))
            // Blocking callback then complete: Spinosa's V1 callback handler
            // reloads providers, so no dispose.
            await root(value.location).provider.oauth.callback(
              { providerID: value.integrationID, method },
              { throwOnError: true },
            )
            return located(
              { status: "complete" as const, time: { created: Date.now(), expires: Date.now() } },
              value.location,
            )
          }
          return unwrapEnvelope(
            await v2.integration.attempt.status({ attemptID: value.attemptID, ...at(value?.location) }),
          ) as IntegrationOauthStatusOutput
        },
        complete: async (value) => {
          if (value.attemptID.startsWith("v1:")) {
            const method = Number(value.attemptID.split(":").at(-1))
            await root(value.location).provider.oauth.callback(
              { providerID: value.integrationID, method, code: value.code },
              { throwOnError: true },
            )
            return
          }
          await v2.integration.attempt.complete({
            attemptID: value.attemptID,
            code: value.code,
            ...at(value?.location),
          })
        },
        cancel: async (value) => {
          if (value.attemptID.startsWith("v1:")) return
          await v2.integration.attempt.cancel({ attemptID: value.attemptID, ...at(value?.location) })
        },
      },
    }),
    command: override(input.current.command, {
      async list(value) {
        // The V1 command tree serves legacy-shaped items (model as
        // "provider/model"); V2 items carry a ModelRef object the list
        // consumer splits as a string, so the facade stays on V1 here. The
        // legacy type claims ModelRef but the runtime contract (loadCommands)
        // splits a string, matching the V1 shape.
        const result = await root(value?.location).command.list(flat(value?.location))
        const data = (result.data ?? []).map((command) => {
          const source = (command as typeof command & { source?: "command" | "mcp" | "skill" }).source
          return {
            name: command.name,
            template: command.template,
            description: command.description,
            agent: command.agent,
            model: command.model as unknown as CommandListOutput["data"][number]["model"],
            subtask: command.subtask,
            ...(source ? { source } : {}),
          }
        })
        return located(data, value?.location)
      },
    }),
    reference: override({} as ServerApi["reference"], {
      async list(value): Promise<ReferenceListOutput> {
        // V2 reference items are structurally identical to the legacy ones.
        return unwrapEnvelope(
          await v2.reference.list(value?.location ? { location: value.location } : undefined),
        ) as ReferenceListOutput
      },
    }),
    mcp: override(input.current.mcp, {
      async list(value) {
        const result = await root(value?.location).mcp.status(flat(value?.location))
        const data = result.data ?? {}
        return located(
          Object.entries(data).map(([name, status]) => ({ name, status })),
          value?.location,
        )
      },
      async connect(value) {
        await root(value?.location).mcp.connect({ name: value.server, ...flat(value?.location) })
      },
      async disconnect(value) {
        await root(value?.location).mcp.disconnect({ name: value.server, ...flat(value?.location) })
      },
      resource: {
        async catalog(value) {
          const resources = await fetchResourceCatalog(
            input.raw,
            directoryOf(value?.location) || undefined,
          )
          return located({ resources, templates: [] }, value?.location)
        },
      },
    }),
  }
}
