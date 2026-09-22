import type { ServerApi } from "./server"
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
  IntegrationOauthConnectOutput,
  IntegrationOauthStatusOutput,
  ModelInfo,
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
        const result = await legacy(value?.location ?? undefined).session.create({
          directory: directory(value?.location ?? undefined),
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
          await legacy(value.location).auth.set({
            providerID: value.integrationID,
            auth: { type: "api", key: value.key },
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
        const result = await legacy(value.location).pty.get({ ptyID: value.ptyID })
        if (!result.data) throw new Error(`Terminal not found: ${value.ptyID}`)
        return located(result.data, value.location)
      },
      async update(value: Parameters<ServerApi["pty"]["update"]>[0]) {
        const result = await legacy(value.location).pty.update({
          ptyID: value.ptyID,
          title: value.title,
          size: value.size,
        })
        if (!result.data) throw new Error(`Terminal not found: ${value.ptyID}`)
        return located(result.data, value.location)
      },
      async remove(value: Parameters<ServerApi["pty"]["remove"]>[0]) {
        await legacy(value.location).pty.remove({ ptyID: value.ptyID })
      },
      // async connectToken(value: Parameters<ServerApi["pty"]["connectToken"]>[0]) {
      //   const result = await legacy(value.location).pty.connectToken({ ptyID: value.ptyID })
      //   if (!result.data) throw new Error(`Failed to connect terminal: ${value.ptyID}`)
      //   return located(result.data, value.location)
      // },
    },
    permission: {
      ...input.current.permission,
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
  }
}

type V2Location = { directory?: string; workspace?: string }

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

/** Active (connected) provider IDs from the served config endpoint. */
export async function fetchActiveProviderIDs(
  raw: GeneratedClient,
  directory?: string,
): Promise<Array<string>> {
  const body = (await unwrapEnvelope(
    await lowClientOf(raw).get({ url: "/config/providers", ...directoryHeaders(directory) }),
  )) as { providers?: Array<{ id: string }> }
  return (body?.providers ?? []).map((provider) => provider.id)
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

function toLegacyModel(model: ModelV2Info): ModelInfo {  const api = model.api.type === "aisdk" ? model.api : undefined
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
 * (`integration`, `model`, `agent`) or whose legacy contract is V2-native
 * (`provider`, `command`, `reference`, `mcp`) are mapped explicitly to the
 * generated `.v2` methods with forwarding receivers (never through the
 * adapting proxy: spreading or re-calling proxied class instances loses the
 * prototype receiver and risks double-unwrapping domain payloads).
 */
function createV2Api(input: CompatibleInput): CompatibleApi {
  const base = createV1Api(input)
  const v2 = input.raw.v2
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
  // Preserve every adapted pass-through method of a namespace while
  // replacing selected methods with explicit V2 mappings. Missing roots
  // (model/agent/reference have no V1 namespace) start from empty.
  const override = <T extends object>(namespace: T | undefined, methods: Partial<T>): T =>
    new Proxy((namespace ?? {}) as T, {
      get(target, property, receiver) {
        if (property in methods) return methods[property as keyof T]
        return Reflect.get(target, property, receiver)
      },
    })
  const root = (location?: V2Location) => input.legacy(directoryOf(location))
  const flat = (location?: V2Location) => {
    const directory = directoryOf(location) || undefined
    return { directory, workspace: location?.workspace }
  }

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
        const body = unwrapEnvelope(await v2.model.list(at(value?.location))) as {
          location: LocationInfo
          data: Array<ModelV2Info>
        }
        return { location: body.location, data: body.data.map(toLegacyModel) }
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
        const body = unwrapEnvelope(await v2.model.list(at(value?.location))) as {
          location: LocationInfo
          data: Array<ModelV2Info>
        }
        const match = body.data.find((item) => item.providerID === providerID && item.id === modelID)
        if (!match) return { location: body.location, data: null }
        return { location: body.location, data: toLegacyModel(match) }
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
    integration: override(base.integration, {
      async list(value): Promise<IntegrationListOutput> {
        return unwrapEnvelope(await v2.integration.list(at(value?.location))) as IntegrationListOutput
      },
      async get(value): Promise<IntegrationGetOutput> {
        return unwrapEnvelope(
          await v2.integration.get({ integrationID: value.integrationID, ...at(value?.location) }),
        ) as IntegrationGetOutput
      },
      connect: {
        key: async (value) => {
          await v2.integration.connect.key({
            integrationID: value.integrationID,
            key: value.key,
            label: value.label,
            ...at(value?.location),
          })
        },
      },
      oauth: {
        connect: async (value): Promise<IntegrationOauthConnectOutput> => {
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
          return unwrapEnvelope(
            await v2.integration.attempt.status({ attemptID: value.attemptID, ...at(value?.location) }),
          ) as IntegrationOauthStatusOutput
        },
        complete: async (value) => {
          await v2.integration.attempt.complete({
            attemptID: value.attemptID,
            code: value.code,
            ...at(value?.location),
          })
        },
        cancel: async (value) => {
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
        const data = (result.data ?? []).map((command) => ({
          name: command.name,
          template: command.template,
          description: command.description,
          agent: command.agent,
          model: command.model as unknown as CommandListOutput["data"][number]["model"],
          subtask: command.subtask,
        }))
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
