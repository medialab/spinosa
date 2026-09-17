import { readdir, readFile } from "node:fs/promises"
import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  SnapshotFileDiff,
  ConsoleState,
} from "@spinosa/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "./project"
import { useEvent } from "./event"
import { useSDK } from "./sdk"
import { useTuiStartup } from "./runtime"
import { createSimpleContext } from "./helper"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onMount } from "solid-js"
import path from "path"
import { useKV } from "./kv"
import { usePermission } from "./permission"
import { dbg } from "../util/debug-log"
import { KV } from "../constants/kv-keys"
import { normalizeToolInputForDisplay, normalizeToolMetadataForDisplay } from "../util/tool-display"
import { errorMessage } from "../util/error"
import { sessionMatchesWorkspaceScope } from "../util/session"
import { bootLogError } from "@spinosa/kernel-core/observability/boot-log"

const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
}

function search<T>(items: T[], target: string, key: (item: T) => string) {
  let left = 0
  let right = items.length - 1
  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const value = key(items[middle])
    if (value === target) return { found: true, index: middle }
    if (value < target) left = middle + 1
    else right = middle - 1
  }
  return { found: false, index: left }
}

function eventTimestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number") return value
  return Date.parse(String(value ?? "")) || fallback
}

/** Project V2 tool content/result into the V1 ToolPart completed `output` string. */
function toolOutputFromV2(content: unknown, result?: unknown): string {
  if (Array.isArray(content)) {
    const texts: string[] = []
    for (const item of content) {
      if (!item || typeof item !== "object") continue
      const row = item as { type?: unknown; text?: unknown }
      if (row.type === "text" && typeof row.text === "string") texts.push(row.text)
    }
    if (texts.length > 0) return texts.join("\n")
  }
  if (typeof result === "string") return result
  if (result !== undefined && result !== null) {
    try {
      return JSON.stringify(result)
    } catch {
      return String(result)
    }
  }
  return ""
}

function unknownErrorMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.length > 0) return message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export const {
  context: SyncContext,
  use: useSync,
  provider: SyncProvider,
} = createSimpleContext({
  name: "Sync",
  init: (props: { sessionDirectory?: () => string | undefined }) => {
    const startup = useTuiStartup()
    const kv = useKV()
    const permission = usePermission()
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      /** Last provider-catalog fetch failure; cleared on success. */
      provider_error: string | undefined
      /**
       * Dedicated provider-catalog fetch state (not derived from the global
       * TUI bootstrap status): only `ready` means provider data was actually
       * committed to the store. `error` offers a retry in the connect dialog.
       */
      provider_catalog: "idle" | "loading" | "ready" | "error"
      console_state: ConsoleState
      capabilities: {
        experimentalBackgroundSubagents: boolean
      }
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: SnapshotFileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      /** Unpromoted V2 admissions: queue shows Steer; cleared on promote. */
      prompt_delivery: {
        [messageID: string]: "steer" | "queue"
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      capabilities: {
        experimentalBackgroundSubagents: false,
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      provider_error: undefined,
      provider_catalog: "idle",
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      prompt_delivery: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()

    const fullSyncedSessions = new Set<string>()
    const syncingSessions = new Map<string, Promise<void>>()
    const hydratingSessions = new Map<string, { messages: Set<string>; parts: Set<string> }>()
    const touchMessage = (sessionID: string, messageID: string) => {
      hydratingSessions.get(sessionID)?.messages.add(messageID)
    }
    const touchPart = (sessionID: string, partID: string) => {
      hydratingSessions.get(sessionID)?.parts.add(partID)
    }

    function sessionListQuery() {
      const directory = props.sessionDirectory?.()
      const wrkWorkspace = project.workspace.current()
      const filterEnabled = kv.get(KV.SESSION_DIRECTORY_FILTER, true)
      dbg("[sync:sessionListQuery]", { directory, workspace: String(wrkWorkspace), filterEnabled })
      if (!filterEnabled) {
        return { scope: "project" as const, workspace: directory ? undefined : wrkWorkspace }
      }
      // Spinosa workspaces scope by directory. Prefer that over experimental
      // workspace ID so we do not AND-filter and drop directory-bound sessions.
      if (directory) return { directory }
      if (wrkWorkspace) return { workspace: wrkWorkspace }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) {
        return { scope: "project" as const, workspace: wrkWorkspace }
      }
      return { directory: project.data.instance.path.directory, workspace: wrkWorkspace }
    }

    async function readLocalSessions(dir: string): Promise<Session[]> {
      const sessionsDir = path.join(dir, ".spinosa", "sessions")
      try {
        const files = await readdir(sessionsDir)
        const jsonFiles = files.filter((f) => f.endsWith(".json"))
        dbg("[sync:readLocalSessions]", { dir, dirExists: true, totalFiles: files.length, jsonFiles: jsonFiles.length })
        const results: Session[] = []
        for (const file of jsonFiles) {
          try {
            const content = await readFile(path.join(sessionsDir, file), "utf-8")
            results.push(JSON.parse(content) as Session)
          } catch { /* skip invalid files */ }
        }
        dbg("[sync:readLocalSessions]", { dir, parsed: results.length })
        return results
      } catch (e) {
        dbg("[sync:readLocalSessions]", { dir, error: (e as Error).message })
        return []
      }
    }

    async function listSessions() {
      const workspaceDir = props.sessionDirectory?.()
      const hostDir = project.data.instance.path.directory
      const bothDirs = [workspaceDir, hostDir].filter(Boolean) as string[]
      const localDirs = [...new Set(bothDirs)]
      dbg("[sync:listSessions]", { workspaceDir, hostDir, localDirs })
      let serverList: Session[] = []
      const localLists = await Promise.all(localDirs.map((d) => readLocalSessions(d)))
      try {
        serverList =
          (await sdk.client.session
            .list({ start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() })
            .then((x) => x.data)) ?? []
        dbg("[sync:listSessions] server returned", { count: serverList.length })
      } catch (e) {
        dbg("[sync:listSessions] server list failed, using local sessions only", { error: String(e) })
      }
      const merged = new Map<string, Session>()
      for (const s of serverList) merged.set(s.id, s)
      for (const list of localLists) {
        for (const s of list) {
          if (!merged.has(s.id)) merged.set(s.id, s)
        }
      }
      let result = [...merged.values()]
      const filterEnabled = kv.get(KV.SESSION_DIRECTORY_FILTER, true)
      if (workspaceDir && filterEnabled) {
        const wrkID = project.workspace.current()
        result = result.filter((s) =>
          sessionMatchesWorkspaceScope(s, { workspaceDir, workspaceID: wrkID }),
        )
      }
      result = result.toSorted((a, b) => a.id.localeCompare(b.id))
      const rootCount = result.filter((s) => s.parentID == null).length
      dbg("[sync:listSessions] merged", { total: result.length, root: rootCount })
      return result
    }

    event.subscribe((event, { directory, workspace }) => {
      // Emitted by the SDK stream loop whenever the global event connection
      // re-establishes after a drop. Events missed while offline are not
      // replayed, so re-fetch the volatile state instead of waiting for the
      // next live event (stale "busy" session rows, missing sessions).
      if ((event as { type: string }).type === "connection.reconnected") {
        void Promise.all([
          listSessions().then((sessions) => setStore("session", reconcile(sessions))),
          sdk.client.session
            .status({ workspace })
            .then((x) => setStore("session_status", reconcile(x.data ?? {})))
            .catch(() => {}),
          sdk.client.vcs
            .get({ workspace })
            .then((x) => setStore("vcs", reconcile(x.data)))
            .catch(() => {}),
        ])
        // Recovery must also repair conversation content: events missed while
        // offline are not replayed, so re-run hydration for sessions with a
        // local projection. Invalidation (not silent reuse) keeps failed
        // hydrations eligible for retry instead of permanently exempt.
        void (async () => {
          const known = Object.keys(store.message)
          for (const sessionID of known) fullSyncedSessions.delete(sessionID)
          for (const sessionID of known) {
            try {
              await result.session.sync(sessionID)
            } catch {
              // Next reconnect or navigation retries; never throw into events.
            }
          }
        })()
        return
      }
      // SDK gen can lag schema for newer session.next.* types; handle those first.
      if ((event as { type: string }).type === "session.next.prompt.delivery.changed") {
        const properties = (event as { properties: { messageID?: string; delivery?: string } }).properties
        const messageID = properties.messageID
        const delivery = properties.delivery
        if (messageID && (delivery === "queue" || delivery === "steer")) {
          setStore("prompt_delivery", messageID, delivery)
        }
        return
      }
      switch (event.type) {
        case "server.instance.disposed":
          void bootstrap()
          break
        case "catalog.updated":
          // refreshProviders records failures in provider_error; swallow
          // here so a failed refresh never throws into the event loop.
          void refreshProviders().catch(() => {})
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          if (permission.mode === "auto") {
            void sdk.client.permission.reply({
              requestID: request.id,
              reply: "once",
              directory,
              workspace,
            })
            break
          }
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.created":
        case "session.updated": {
          const info = event.properties.info
          if (!info || typeof info !== "object" || typeof (info as { id?: unknown }).id !== "string") break
          const result = search(store.session, (info as { id: string }).id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, info as never)
            }),
          )
          break
        }

        case "session.next.moved": {
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.directory = event.properties.location.directory
              session.path = event.properties.subdirectory
              session.workspaceID = event.properties.location.workspaceID
              session.time.updated = event.properties.timestamp
            }),
          )
          break
        }

        case "session.next.revert.staged": {
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.revert = event.properties.revert as typeof session.revert
              session.time.updated =
                typeof event.properties.timestamp === "number"
                  ? event.properties.timestamp
                  : Date.parse(String(event.properties.timestamp ?? "")) || session.time.updated
            }),
          )
          break
        }

        case "session.next.revert.cleared":
        case "session.next.revert.committed": {
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.revert = undefined
              session.time.updated =
                typeof event.properties.timestamp === "number"
                  ? event.properties.timestamp
                  : Date.parse(String(event.properties.timestamp ?? "")) || session.time.updated
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        // V2 session.next.* → V1 message/part store so the shipped conversation
        // UI keeps rendering when prompts run through SessionV2.
        case "session.next.prompt.admitted":
        case "session.next.prompted": {
          const sessionID = event.properties.sessionID as string
          const messageID = event.properties.messageID as string
          const created =
            typeof event.properties.timestamp === "number"
              ? event.properties.timestamp
              : Date.parse(String(event.properties.timestamp ?? "")) || Date.now()
          const text =
            typeof event.properties.prompt?.text === "string" ? event.properties.prompt.text : ""
          const delivery =
            event.properties.delivery === "queue" || event.properties.delivery === "steer"
              ? event.properties.delivery
              : undefined
          const info = {
            id: messageID,
            sessionID,
            role: "user" as const,
            time: { created },
            agent: "build",
            model: { providerID: "", modelID: "" },
          }
          touchMessage(sessionID, messageID)
          const messages = store.message[sessionID]
          if (!messages) setStore("message", sessionID, [info])
          else {
            const result = search(messages, messageID, (m) => m.id)
            if (!result.found) {
              setStore(
                "message",
                sessionID,
                produce((draft) => {
                  draft.splice(result.index, 0, info)
                }),
              )
            }
          }
          const part = {
            id: `part_${messageID}_text`,
            sessionID,
            messageID,
            type: "text" as const,
            text,
          }
          const attachmentParts: Array<Record<string, unknown>> = [part]
          const files = Array.isArray(event.properties.prompt?.files) ? event.properties.prompt.files : []
          for (const [index, file] of files.entries()) {
            if (!file || typeof file !== "object") continue
            const row = file as { uri?: unknown; mime?: unknown; name?: unknown }
            if (typeof row.uri !== "string" || typeof row.mime !== "string") continue
            attachmentParts.push({
              id: `part_${messageID}_file_${index}`,
              sessionID,
              messageID,
              type: "file",
              url: row.uri,
              mime: row.mime,
              ...(typeof row.name === "string" ? { filename: row.name } : {}),
            })
          }
          const agents = Array.isArray(event.properties.prompt?.agents) ? event.properties.prompt.agents : []
          for (const [index, agent] of agents.entries()) {
            if (!agent || typeof agent !== "object") continue
            const row = agent as { name?: unknown }
            if (typeof row.name !== "string") continue
            attachmentParts.push({
              id: `part_${messageID}_agent_${index}`,
              sessionID,
              messageID,
              type: "agent",
              name: row.name,
            })
          }
          if (!store.part[messageID]) setStore("part", messageID, attachmentParts as never)
          if (event.type === "session.next.prompt.admitted" && delivery) {
            setStore("prompt_delivery", messageID, delivery)
          } else if (event.type === "session.next.prompted") {
            setStore(
              "prompt_delivery",
              produce((draft) => {
                delete draft[messageID]
              }),
            )
          }
          break
        }

        case "session.next.agent.switched": {
          const sessionID = event.properties.sessionID as string
          const agent = typeof event.properties.agent === "string" ? event.properties.agent : undefined
          if (!agent) break
          const messages = store.message[sessionID]
          if (!messages?.length) break
          // Prefer the named message, else the latest assistant footer label.
          const targetID = typeof event.properties.messageID === "string" ? event.properties.messageID : undefined
          const index = targetID
            ? messages.findIndex((m) => m.id === targetID)
            : [...messages].reverse().findIndex((m) => m.role === "assistant")
          const resolved = targetID
            ? index
            : index >= 0
              ? messages.length - 1 - index
              : -1
          if (resolved < 0) break
          setStore(
            "message",
            sessionID,
            resolved,
            produce((message) => {
              if (message.role === "assistant" || message.role === "user") {
                message.agent = agent
              }
            }),
          )
          break
        }

        case "session.next.model.switched": {
          const sessionID = event.properties.sessionID as string
          const model = event.properties.model as
            | { providerID?: string; id?: string; modelID?: string }
            | undefined
          const modelID =
            (typeof model?.id === "string" && model.id) ||
            (typeof model?.modelID === "string" && model.modelID) ||
            ""
          const providerID = typeof model?.providerID === "string" ? model.providerID : ""
          if (!modelID && !providerID) break
          const messages = store.message[sessionID]
          if (!messages?.length) break
          const targetID = typeof event.properties.messageID === "string" ? event.properties.messageID : undefined
          const index = targetID
            ? messages.findIndex((m) => m.id === targetID)
            : [...messages].reverse().findIndex((m) => m.role === "assistant")
          const resolved = targetID
            ? index
            : index >= 0
              ? messages.length - 1 - index
              : -1
          if (resolved < 0) break
          setStore(
            "message",
            sessionID,
            resolved,
            produce((message) => {
              if (message.role === "assistant") {
                if (modelID) message.modelID = modelID
                if (providerID) message.providerID = providerID
              } else if (message.role === "user") {
                message.model = {
                  providerID: providerID || message.model?.providerID || "",
                  modelID: modelID || message.model?.modelID || "",
                }
              }
            }),
          )
          break
        }

        case "session.next.synthetic":
        case "session.next.context.updated": {
          const sessionID = event.properties.sessionID as string
          const messageID = event.properties.messageID as string
          const created = eventTimestamp(event.properties.timestamp)
          const text = typeof event.properties.text === "string" ? event.properties.text : ""
          const info = {
            id: messageID,
            sessionID,
            role: "user" as const,
            time: { created },
            agent: "build",
            model: { providerID: "", modelID: "" },
          }
          touchMessage(sessionID, messageID)
          const messages = store.message[sessionID]
          if (!messages) setStore("message", sessionID, [info])
          else {
            const result = search(messages, messageID, (m) => m.id)
            if (!result.found) {
              setStore(
                "message",
                sessionID,
                produce((draft) => {
                  draft.splice(result.index, 0, info)
                }),
              )
            }
          }
          const part = {
            id: `part_${messageID}_synthetic`,
            sessionID,
            messageID,
            type: "text" as const,
            text,
            synthetic: true as const,
          }
          if (!store.part[messageID]) setStore("part", messageID, [part])
          else {
            const parts = store.part[messageID]
            const existing = search(parts, part.id, (p) => p.id)
            if (!existing.found) {
              setStore(
                "part",
                messageID,
                produce((draft) => {
                  draft.splice(existing.index, 0, part)
                }),
              )
            }
          }
          break
        }

        case "session.next.shell.started": {
          const sessionID = event.properties.sessionID as string
          const messageID = event.properties.messageID as string
          const callID = event.properties.callID as string
          const command = typeof event.properties.command === "string" ? event.properties.command : ""
          const created = eventTimestamp(event.properties.timestamp)
          const info = {
            id: messageID,
            sessionID,
            role: "assistant" as const,
            time: { created },
            parentID: messageID,
            modelID: "",
            providerID: "",
            mode: "build",
            agent: "build",
            path: { cwd: "", root: "" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          }
          touchMessage(sessionID, messageID)
          touchPart(sessionID, callID)
          const messages = store.message[sessionID]
          if (!messages) setStore("message", sessionID, [info])
          else {
            const result = search(messages, messageID, (m) => m.id)
            if (!result.found) {
              setStore(
                "message",
                sessionID,
                produce((draft) => {
                  draft.splice(result.index, 0, info)
                }),
              )
            }
          }
          const part = {
            id: callID,
            sessionID,
            messageID,
            type: "tool" as const,
            callID,
            tool: "bash",
            state: {
              status: "running" as const,
              input: { command },
              time: { start: created },
            },
          }
          const parts = store.part[messageID]
          if (!parts) setStore("part", messageID, [part])
          else {
            const existing = search(parts, callID, (p) => p.id)
            if (!existing.found) {
              setStore(
                "part",
                messageID,
                produce((draft) => {
                  draft.splice(existing.index, 0, part)
                }),
              )
            } else {
              setStore(
                "part",
                messageID,
                produce((draft) => {
                  const row = draft[existing.index]
                  if (!row || row.type !== "tool") return
                  row.tool = "bash"
                  row.state = {
                    status: "running",
                    input: { command },
                    time: { start: created },
                  }
                }),
              )
            }
          }
          break
        }

        case "session.next.shell.ended": {
          const sessionID = event.properties.sessionID as string
          const callID = event.properties.callID as string
          const output = typeof event.properties.output === "string" ? event.properties.output : ""
          const ended = eventTimestamp(event.properties.timestamp)
          let messageID: string | undefined
          for (const [id, parts] of Object.entries(store.part)) {
            if (parts.some((p) => p.id === callID || (p.type === "tool" && p.callID === callID))) {
              messageID = id
              break
            }
          }
          if (!messageID) break
          const parts = store.part[messageID]
          const result = search(parts, callID, (p) => p.id)
          if (!result.found) break
          touchPart(sessionID, callID)
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[result.index]
              if (!part || part.type !== "tool") return
              const input =
                part.state.status === "pending"
                  ? { command: "" }
                  : ((part.state.input as Record<string, unknown> | undefined) ?? { command: "" })
              const start =
                part.state.status === "running" || part.state.status === "completed" || part.state.status === "error"
                  ? (part.state.time?.start ?? ended)
                  : ended
              part.tool = "bash"
              part.state = {
                status: "completed",
                input,
                output,
                title: "shell",
                metadata: {
                  ...(part.state.status === "running" ? (part.state.metadata ?? {}) : {}),
                  output,
                },
                time: { start, end: ended },
              }
            }),
          )
          break
        }

        case "session.next.retried": {
          const sessionID = event.properties.sessionID as string
          const attempt = typeof event.properties.attempt === "number" ? event.properties.attempt : 0
          const error = event.properties.error as { message?: unknown } | undefined
          const message =
            error && typeof error.message === "string" && error.message.length > 0
              ? error.message
              : "Retrying…"
          setStore("session_status", sessionID, {
            type: "retry",
            attempt,
            message,
            next: eventTimestamp(event.properties.timestamp) + 1000,
          })
          break
        }

        case "session.next.compaction.started":
        case "session.next.compaction.delta":
          break

        case "session.next.compaction.ended": {
          const sessionID = event.properties.sessionID as string
          const messageID = event.properties.messageID as string
          const created = eventTimestamp(event.properties.timestamp)
          const reason = event.properties.reason === "manual" ? "manual" : "auto"
          const info = {
            id: messageID,
            sessionID,
            role: "user" as const,
            time: { created },
            agent: "build",
            model: { providerID: "", modelID: "" },
          }
          touchMessage(sessionID, messageID)
          const messages = store.message[sessionID]
          if (!messages) setStore("message", sessionID, [info])
          else {
            const result = search(messages, messageID, (m) => m.id)
            if (!result.found) {
              setStore(
                "message",
                sessionID,
                produce((draft) => {
                  draft.splice(result.index, 0, info)
                }),
              )
            }
          }
          const part = {
            id: `part_${messageID}_compaction`,
            sessionID,
            messageID,
            type: "compaction" as const,
            auto: reason === "auto",
          }
          if (!store.part[messageID]) setStore("part", messageID, [part])
          else {
            const parts = store.part[messageID]
            const existing = search(parts, part.id, (p) => p.id)
            if (!existing.found) {
              setStore(
                "part",
                messageID,
                produce((draft) => {
                  draft.splice(existing.index, 0, part)
                }),
              )
            }
          }
          break
        }

        case "session.next.step.started": {
          const sessionID = event.properties.sessionID as string
          const messageID = event.properties.assistantMessageID as string
          const created =
            typeof event.properties.timestamp === "number"
              ? event.properties.timestamp
              : Date.parse(String(event.properties.timestamp ?? "")) || Date.now()
          const model = event.properties.model as
            | { providerID?: string; id?: string; modelID?: string; variant?: string }
            | undefined
          const modelID =
            (typeof model?.id === "string" && model.id) ||
            (typeof model?.modelID === "string" && model.modelID) ||
            ""
          const providerID = typeof model?.providerID === "string" ? model.providerID : ""
          const info = {
            id: messageID,
            sessionID,
            role: "assistant" as const,
            time: { created },
            parentID: messageID,
            modelID,
            providerID,
            mode: "build",
            agent: typeof event.properties.agent === "string" ? event.properties.agent : "build",
            path: { cwd: "", root: "" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          }
          touchMessage(sessionID, messageID)
          const messages = store.message[sessionID]
          if (!messages) setStore("message", sessionID, [info])
          else {
            const result = search(messages, messageID, (m) => m.id)
            if (result.found) setStore("message", sessionID, result.index, reconcile(info))
            else {
              setStore(
                "message",
                sessionID,
                produce((draft) => {
                  draft.splice(result.index, 0, info)
                }),
              )
            }
          }
          if (!store.part[messageID]) setStore("part", messageID, [])
          break
        }

        case "session.next.text.started": {
          const sessionID = event.properties.sessionID as string
          const messageID = event.properties.assistantMessageID as string
          const partID = event.properties.textID as string
          const part = {
            id: partID,
            sessionID,
            messageID,
            type: "text" as const,
            text: "",
            time: { start: Date.now() },
          }
          touchPart(sessionID, partID)
          const parts = store.part[messageID]
          if (!parts) setStore("part", messageID, [part])
          else {
            const result = search(parts, partID, (p) => p.id)
            if (!result.found) {
              setStore(
                "part",
                messageID,
                produce((draft) => {
                  draft.splice(result.index, 0, part)
                }),
              )
            }
          }
          break
        }

        case "session.next.text.delta": {
          const messageID = event.properties.assistantMessageID as string
          const partID = event.properties.textID as string
          const delta = typeof event.properties.delta === "string" ? event.properties.delta : ""
          const parts = store.part[messageID]
          if (!parts) break
          const result = search(parts, partID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, partID)
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[result.index]
              if (part && part.type === "text") part.text = (part.text ?? "") + delta
            }),
          )
          break
        }

        case "session.next.text.ended": {
          const messageID = event.properties.assistantMessageID as string
          const partID = event.properties.textID as string
          const text = typeof event.properties.text === "string" ? event.properties.text : ""
          const parts = store.part[messageID]
          if (!parts) break
          const result = search(parts, partID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, partID)
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[result.index]
              if (part && part.type === "text") {
                part.text = text
                if (part.time) part.time.end = eventTimestamp(event.properties.timestamp)
              }
            }),
          )
          break
        }

        case "session.next.reasoning.started": {
          const sessionID = event.properties.sessionID as string
          const messageID = event.properties.assistantMessageID as string
          const partID = event.properties.reasoningID as string
          const started = eventTimestamp(event.properties.timestamp)
          const part = {
            id: partID,
            sessionID,
            messageID,
            type: "reasoning" as const,
            text: "",
            time: { start: started },
            ...(event.properties.providerMetadata
              ? { metadata: event.properties.providerMetadata as Record<string, unknown> }
              : {}),
          }
          touchPart(sessionID, partID)
          const parts = store.part[messageID]
          if (!parts) setStore("part", messageID, [part])
          else {
            const result = search(parts, partID, (p) => p.id)
            if (!result.found) {
              setStore(
                "part",
                messageID,
                produce((draft) => {
                  draft.splice(result.index, 0, part)
                }),
              )
            }
          }
          break
        }

        case "session.next.reasoning.delta": {
          const messageID = event.properties.assistantMessageID as string
          const partID = event.properties.reasoningID as string
          const delta = typeof event.properties.delta === "string" ? event.properties.delta : ""
          const parts = store.part[messageID]
          if (!parts) break
          const result = search(parts, partID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, partID)
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[result.index]
              if (part && part.type === "reasoning") part.text = (part.text ?? "") + delta
            }),
          )
          break
        }

        case "session.next.reasoning.ended": {
          const messageID = event.properties.assistantMessageID as string
          const partID = event.properties.reasoningID as string
          const text = typeof event.properties.text === "string" ? event.properties.text : ""
          const ended = eventTimestamp(event.properties.timestamp)
          const parts = store.part[messageID]
          if (!parts) break
          const result = search(parts, partID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, partID)
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[result.index]
              if (!part || part.type !== "reasoning") return
              part.text = text
              part.time = { start: part.time?.start ?? ended, end: ended }
              if (event.properties.providerMetadata !== undefined) {
                part.metadata = event.properties.providerMetadata as Record<string, unknown>
              }
            }),
          )
          break
        }

        case "session.next.tool.input.started": {
          const sessionID = event.properties.sessionID as string
          const messageID = event.properties.assistantMessageID as string
          const callID = event.properties.callID as string
          const tool =
            typeof event.properties.name === "string" && event.properties.name.length > 0
              ? event.properties.name
              : "tool"
          const part = {
            id: callID,
            sessionID,
            messageID,
            type: "tool" as const,
            callID,
            tool,
            state: { status: "pending" as const, input: {}, raw: "" },
          }
          touchPart(sessionID, callID)
          const parts = store.part[messageID]
          if (!parts) setStore("part", messageID, [part])
          else {
            const result = search(parts, callID, (p) => p.id)
            if (!result.found) {
              setStore(
                "part",
                messageID,
                produce((draft) => {
                  draft.splice(result.index, 0, part)
                }),
              )
            }
          }
          break
        }

        case "session.next.tool.input.delta": {
          const messageID = event.properties.assistantMessageID as string
          const callID = event.properties.callID as string
          const delta = typeof event.properties.delta === "string" ? event.properties.delta : ""
          const parts = store.part[messageID]
          if (!parts) break
          const result = search(parts, callID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, callID)
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[result.index]
              if (part?.type === "tool" && part.state.status === "pending") {
                part.state.raw = (part.state.raw ?? "") + delta
              }
            }),
          )
          break
        }

        case "session.next.tool.input.ended": {
          const messageID = event.properties.assistantMessageID as string
          const callID = event.properties.callID as string
          const text = typeof event.properties.text === "string" ? event.properties.text : ""
          const parts = store.part[messageID]
          if (!parts) break
          const result = search(parts, callID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, callID)
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[result.index]
              if (part?.type === "tool" && part.state.status === "pending") {
                part.state.raw = text
              }
            }),
          )
          break
        }

        case "session.next.tool.called": {
          const sessionID = event.properties.sessionID as string
          const messageID = event.properties.assistantMessageID as string
          const callID = event.properties.callID as string
          const tool =
            typeof event.properties.tool === "string" && event.properties.tool.length > 0
              ? event.properties.tool
              : "tool"
          const input = normalizeToolInputForDisplay(
            event.properties.input && typeof event.properties.input === "object"
              ? (event.properties.input as Record<string, unknown>)
              : {},
          )
          const started = eventTimestamp(event.properties.timestamp)
          const parts = store.part[messageID]
          const existing = parts ? search(parts, callID, (p) => p.id) : { found: false, index: 0 }
          touchPart(sessionID, callID)
          if (!parts || !existing.found) {
            const part = {
              id: callID,
              sessionID,
              messageID,
              type: "tool" as const,
              callID,
              tool,
              state: {
                status: "running" as const,
                input,
                time: { start: started },
                ...(event.properties.provider?.executed ? { metadata: { providerExecuted: true } } : {}),
              },
            }
            if (!parts) setStore("part", messageID, [part])
            else {
              setStore(
                "part",
                messageID,
                produce((draft) => {
                  draft.splice(existing.index, 0, part)
                }),
              )
            }
            break
          }
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[existing.index]
              if (!part || part.type !== "tool") return
              part.tool = tool
              const providerExecuted =
                event.properties.provider?.executed === true || part.metadata?.providerExecuted === true
              part.state = {
                status: "running",
                input,
                time: { start: started },
                ...(providerExecuted ? { metadata: { providerExecuted: true } } : {}),
              }
            }),
          )
          break
        }

        case "session.next.tool.progress": {
          const messageID = event.properties.assistantMessageID as string
          const callID = event.properties.callID as string
          const structured =
            event.properties.structured && typeof event.properties.structured === "object"
              ? (event.properties.structured as Record<string, unknown>)
              : {}
          const parts = store.part[messageID]
          if (!parts) break
          const result = search(parts, callID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, callID)
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[result.index]
              if (part?.type !== "tool" || part.state.status !== "running") return
              part.state.metadata = { ...part.state.metadata, ...structured }
              if (typeof structured.title === "string") part.state.title = structured.title
            }),
          )
          break
        }

        case "session.next.tool.success": {
          const messageID = event.properties.assistantMessageID as string
          const callID = event.properties.callID as string
          const structured =
            event.properties.structured && typeof event.properties.structured === "object"
              ? (event.properties.structured as Record<string, unknown>)
              : {}
          const ended = eventTimestamp(event.properties.timestamp)
          const parts = store.part[messageID]
          if (!parts) break
          const result = search(parts, callID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, callID)
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[result.index]
              if (!part || part.type !== "tool") return
              const input = normalizeToolInputForDisplay(
                part.state.status === "pending"
                  ? {}
                  : ((part.state.input as Record<string, unknown> | undefined) ?? {}),
              )
              const start =
                part.state.status === "running" || part.state.status === "completed" || part.state.status === "error"
                  ? (part.state.time?.start ?? ended)
                  : ended
              const title =
                typeof structured.title === "string"
                  ? structured.title
                  : part.tool
              const prior =
                part.state.status === "running" ? ((part.state.metadata as Record<string, unknown> | undefined) ?? {}) : {}
              part.state = {
                status: "completed",
                input,
                output: toolOutputFromV2(event.properties.content, event.properties.result),
                title,
                metadata: normalizeToolMetadataForDisplay(part.tool, { ...prior, ...structured }, input),
                time: { start, end: ended },
              }
            }),
          )
          break
        }

        case "session.next.tool.failed": {
          const messageID = event.properties.assistantMessageID as string
          const callID = event.properties.callID as string
          const ended = eventTimestamp(event.properties.timestamp)
          const parts = store.part[messageID]
          if (!parts) break
          const result = search(parts, callID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, callID)
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[result.index]
              if (!part || part.type !== "tool") return
              if (part.state.status !== "pending" && part.state.status !== "running") return
              const input = normalizeToolInputForDisplay(
                part.state.status === "pending"
                  ? {}
                  : ((part.state.input as Record<string, unknown> | undefined) ?? {}),
              )
              const start = part.state.status === "running" ? (part.state.time?.start ?? ended) : ended
              part.state = {
                status: "error",
                input,
                error: unknownErrorMessage(event.properties.error),
                metadata: part.state.status === "running" ? part.state.metadata : undefined,
                time: { start, end: ended },
              }
            }),
          )
          break
        }

        case "session.next.step.ended":
        case "session.next.step.failed": {
          const sessionID = event.properties.sessionID as string
          const messageID = event.properties.assistantMessageID as string
          const messages = store.message[sessionID]
          if (!messages) break
          const result = search(messages, messageID, (m) => m.id)
          if (!result.found) break
          const completed =
            typeof event.properties.timestamp === "number"
              ? event.properties.timestamp
              : Date.parse(String(event.properties.timestamp ?? "")) || Date.now()
          const endedTokens =
            event.type === "session.next.step.ended" &&
            event.properties.tokens &&
            typeof event.properties.tokens === "object"
              ? (event.properties.tokens as {
                  input?: number
                  output?: number
                  reasoning?: number
                  cache?: { read?: number; write?: number }
                })
              : undefined
          const endedCost =
            event.type === "session.next.step.ended" && typeof event.properties.cost === "number"
              ? event.properties.cost
              : undefined
          setStore(
            "message",
            sessionID,
            result.index,
            produce((message) => {
              if (message.role !== "assistant") return
              message.time.completed = completed
              if (event.type === "session.next.step.ended" && typeof event.properties.finish === "string") {
                message.finish = event.properties.finish
              }
              if (endedTokens) {
                message.tokens = {
                  input: endedTokens.input ?? 0,
                  output: endedTokens.output ?? 0,
                  reasoning: endedTokens.reasoning ?? 0,
                  cache: {
                    read: endedTokens.cache?.read ?? 0,
                    write: endedTokens.cache?.write ?? 0,
                  },
                }
              }
              if (endedCost !== undefined) message.cost = endedCost
              if (event.type === "session.next.step.failed") {
                message.finish = "error"
              }
            }),
          )
          // Keep session aggregate cost in sync with V2 step settlements (prompt footer).
          if (endedCost !== undefined && endedCost > 0) {
            const sessions = store.session
            const sessionIndex = sessions.findIndex((item) => item.id === sessionID)
            if (sessionIndex >= 0) {
              setStore(
                "session",
                sessionIndex,
                produce((session) => {
                  session.cost = (session.cost ?? 0) + endedCost
                }),
              )
            }
          }
          break
        }

        case "permission.v2.asked": {
          const request = event.properties as {
            id: string
            sessionID: string
            action: string
            resources: string[]
            save?: string[]
            metadata?: Record<string, unknown>
            source?: { type: "tool"; messageID: string; callID: string }
          }
          const mapped = {
            id: request.id,
            sessionID: request.sessionID,
            permission: request.action,
            patterns: request.resources,
            metadata: { ...(request.metadata ?? {}), __v2: true },
            always: request.save ?? [],
            ...(request.source?.type === "tool"
              ? { tool: { messageID: request.source.messageID, callID: request.source.callID } }
              : {}),
          }
          if (permission.mode === "auto") {
            void sdk.client.v2.session.permission.reply({
              sessionID: mapped.sessionID,
              requestID: mapped.id,
              reply: "once",
            })
            break
          }
          const requests = store.permission[mapped.sessionID]
          if (!requests) {
            setStore("permission", mapped.sessionID, [mapped])
            break
          }
          const match = search(requests, mapped.id, (r) => r.id)
          if (match.found) {
            setStore("permission", mapped.sessionID, match.index, reconcile(mapped))
            break
          }
          setStore(
            "permission",
            mapped.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, mapped)
            }),
          )
          break
        }

        case "permission.v2.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "message.updated": {
          touchMessage(event.properties.info.sessionID, event.properties.info.id)
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        case "message.removed": {
          touchMessage(event.properties.sessionID, event.properties.messageID)
          const messages = store.message[event.properties.sessionID]
          const result = search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          touchPart(event.properties.part.sessionID, event.properties.part.id)
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = search(parts, event.properties.partID, (p) => p.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, event.properties.partID)
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field as keyof typeof part
              const existing = part[field] as string | undefined
              ;(part[field] as string) = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "message.part.removed": {
          touchPart(event.properties.sessionID, event.properties.partID)
          const parts = store.part[event.properties.messageID]
          const result = search(parts, event.properties.partID, (p) => p.id)
          if (result.found) {
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data ?? []))
          break
        }

        case "vcs.branch.updated": {
          if (workspace === project.workspace.current()) {
            setStore("vcs", { branch: event.properties.branch })
          }
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    let bootstrapFlight: Promise<void> | undefined
    async function bootstrap(input: { fatal?: boolean } = {}) {
      if (bootstrapFlight) return bootstrapFlight
      bootstrapFlight = runBootstrap(input).finally(() => {
        bootstrapFlight = undefined
      })
      return bootstrapFlight
    }

    async function refreshProviders() {
      const workspace = project.workspace.current()
      setStore("provider_catalog", "loading")
      try {
        const [providers, providerList] = await Promise.all([
          sdk.client.config.providers({ workspace }, { throwOnError: true }),
          sdk.client.provider.list({ workspace }, { throwOnError: true }),
        ])
        batch(() => {
          setStore("provider", reconcile(providers.data!.providers))
          setStore("provider_default", reconcile(providers.data!.default))
          setStore("provider_next", reconcile(providerList.data!))
          setStore("provider_error", undefined)
          setStore("provider_catalog", "ready")
        })
      } catch (error) {
        // Record the failure so the connect dialog can offer a retry
        // instead of showing a bare empty list. Rethrow: callers decide
        // whether to toast.
        batch(() => {
          setStore("provider_error", errorMessage(error).slice(0, 300))
          setStore("provider_catalog", "error")
        })
        throw error
      }
    }

    async function runBootstrap(input: { fatal?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions())

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
      // Attribute catalog failures precisely: the bootstrap catch below
      // cannot tell which fetch failed, but the connect dialog needs to
      // know the provider list specifically failed so it can offer a retry.
      // NOTE: success clears nothing here — provider_error is only cleared
      // (and the catalog marked ready) in the commit batch below, so a
      // config.providers() failure cannot leave a committed-looking empty
      // catalog with no retry row.
      let providerListSettled = false
      setStore("provider_catalog", "loading")
      const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true }).then(
        (response) => {
          return response
        },
        (error) => {
          providerListSettled = true
          batch(() => {
            setStore("provider_error", errorMessage(error).slice(0, 300))
            setStore("provider_catalog", "error")
          })
          throw error
        },
      )
      const capabilitiesPromise = sdk.client.experimental.capabilities
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => undefined)
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => emptyConsoleState)
      const agentsPromise = sdk.client.app.agents({ workspace }, { throwOnError: true })
      const configPromise = sdk.client.config.get({ workspace }, { throwOnError: true })
      await Promise.all([
        providersPromise,
        providerListPromise,
        capabilitiesPromise,
        agentsPromise,
        configPromise,
        projectPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ])
        .then(async () => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const capabilitiesResponse = capabilitiesPromise
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            capabilitiesResponse,
            consoleStateResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const capabilities = responses[2]
            const consoleState = responses[3]
            const agents = responses[4]
            const config = responses[5]
            const sessions = responses[6]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("provider_error", undefined)
              setStore("provider_catalog", "ready")
              setStore("capabilities", "experimentalBackgroundSubagents", capabilities?.backgroundSubagents === true)
              setStore("console_state", reconcile(consoleState))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          void Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status({ workspace }).then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            sdk.client.experimental.resource
              .list({ workspace })
              .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data ?? []))),
            sdk.client.session.status({ workspace }).then((x) => {
              setStore("session_status", reconcile(x.data ?? {}))
            }),
            sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
            project.workspace.sync(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          bootLogError("tui.bootstrap", e)
          console.error("tui bootstrap failed", e instanceof Error ? e.message : String(e))
          // The commit batch above never ran: provider data (if any) was not
          // stored. A still-loading catalog here means /provider succeeded but
          // a sibling leg (e.g. config.providers) failed — surface a retry
          // instead of an empty list with no recovery row.
          if (store.provider_catalog === "loading" && !providerListSettled) {
            batch(() => {
              setStore(
                "provider_error",
                `Provider list did not finish loading: ${errorMessage(e).slice(0, 200)}`,
              )
              setStore("provider_catalog", "error")
            })
          }
          setStore("status", "partial")
          if (fatal) {
            exit(e)
          }
          // Non-fatal: stay in degraded/partial mode so the TUI remains usable.
        })
    }

    onMount(() => {
      // Non-fatal bootstrap: provider/config failures should degrade, not kill the TUI.
      void bootstrap({ fatal: false }).catch((e) => {
        bootLogError("tui.bootstrap.degraded", e)
        console.error("tui bootstrap degraded", e instanceof Error ? e.message : String(e))
        setStore("status", "partial")
      })
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (startup.skipInitialLoading) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        /** Insert/replace a session optimistically (e.g. right after session.create). */
        upsert(info: Session) {
          setStore(
            "session",
            produce((draft) => {
              const match = search(draft, info.id, (s) => s.id)
              if (match.found) {
                draft[match.index] = info
                return
              }
              draft.splice(match.index, 0, info)
            }),
          )
        },
        query() {
          return sessionListQuery()
        },
        async refresh() {
          const list = await listSessions()
          setStore("session", reconcile(list))
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const syncing = syncingSessions.get(sessionID)
          if (syncing) return syncing
          const tracker = { messages: new Set<string>(), parts: new Set<string>() }
          hydratingSessions.set(sessionID, tracker)
          const task = (async () => {
            const [session, messages, todo, diff] = await Promise.all([
              sdk.client.session.get({ sessionID }, { throwOnError: true }),
              // Isolated: a failed history request must never masquerade as
              // an empty transcript (see below).
              sdk.client.session.messages({ sessionID, limit: 100 }).catch(() => undefined),
              sdk.client.session.todo({ sessionID }),
              sdk.client.session.diff({ sessionID }),
            ])
            // An SDK error response carries no data: keep the last known
            // good projection and stay eligible for a later retry instead
            // of replacing history with [] and marking it fully synced.
            const messageList = messages?.data
            const messagesOk = Array.isArray(messageList)
            setStore(
              produce((draft) => {
                const match = search(draft.session, sessionID, (s) => s.id)
                if (match.found) draft.session[match.index] = session.data!
                if (!match.found) draft.session.splice(match.index, 0, session.data!)
                draft.todo[sessionID] = todo.data ?? []
                if (!messagesOk) return
                const currentMessages = draft.message[sessionID] ?? []
                const infos = (messageList ?? []).flatMap((message) => {
                  if (!tracker.messages.has(message.info.id)) return [message.info]
                  const current = currentMessages.find((item) => item.id === message.info.id)
                  return current ? [current] : []
                })
                infos.push(
                  ...currentMessages.filter(
                    (message) => tracker.messages.has(message.id) && !infos.some((item) => item.id === message.id),
                  ),
                )
                const removed = infos.slice(0, -100)
                const visible = infos.slice(-100)
                const visibleIDs = new Set(visible.map((message) => message.id))
                for (const message of messageList ?? []) {
                  if (!visibleIDs.has(message.info.id)) {
                    delete draft.part[message.info.id]
                    continue
                  }
                  const currentParts = draft.part[message.info.id] ?? []
                  const parts = message.parts.flatMap((part) => {
                    const current = currentParts.find((item) => item.id === part.id)
                    if (tracker.parts.has(part.id)) return current ? [current] : []
                    if (
                      current &&
                      (part.type === "text" || part.type === "reasoning") &&
                      (current.type === "text" || current.type === "reasoning") &&
                      part.text.length === 0 &&
                      current.text.length > 0
                    ) {
                      return [current]
                    }
                    return [part]
                  })
                  parts.push(
                    ...currentParts.filter(
                      (part) => tracker.parts.has(part.id) && !parts.some((item) => item.id === part.id),
                    ),
                  )
                  draft.part[message.info.id] = parts
                }
                for (const message of removed) delete draft.part[message.id]
                draft.message[sessionID] = visible
                draft.session_diff[sessionID] = diff.data ?? []
              }),
            )
            if (messagesOk) fullSyncedSessions.add(sessionID)
          })().finally(() => {
            syncingSessions.delete(sessionID)
            hydratingSessions.delete(sessionID)
          })
          syncingSessions.set(sessionID, task)
          return task
        },
      },
      bootstrap,
      refreshProviders,
    }
    return result
  },
})
