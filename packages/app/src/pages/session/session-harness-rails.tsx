import { For, Show, createMemo, type Accessor, type JSX } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import type { Message, ToolPart } from "@spinosa/sdk/v2"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { legacySessionHref, requireServerKey, sessionHref } from "@/utils/session-route"

type ToolSummary = {
  tool: string
  count: number
  active: boolean
  errors: number
}

type SubagentRun = {
  id: string
  description: string
  status: ToolPart["state"]["status"]
  childID?: string
}

function useAssistantToolParts(messages: Accessor<Message[]>) {
  const sync = useSync()
  return createMemo(() => {
    const parts: ToolPart[] = []
    for (const message of messages()) {
      if (message.role !== "assistant") continue
      for (const part of sync().data.part[message.id] ?? []) {
        if (part.type === "tool") parts.push(part)
      }
    }
    return parts
  })
}

function statusDot(status: ToolPart["state"]["status"]) {
  if (status === "running" || status === "pending") return "bg-icon-warning-base animate-pulse"
  if (status === "error") return "bg-icon-critical-base"
  return "bg-icon-success-base"
}

function RailSection(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex min-w-0 flex-col gap-1">
      <div class="px-1.5 text-12-regular text-text-weak">{props.title}</div>
      {props.children}
    </section>
  )
}

// Left column of the conversation: every tool used in this session,
// mirroring the TUI transcript tool callouts.
export function SessionToolsRail(props: { messages: Accessor<Message[]> }) {
  const language = useLanguage()
  const toolParts = useAssistantToolParts(props.messages)
  const tools = createMemo<ToolSummary[]>(() => {
    const summaries = new Map<string, ToolSummary>()
    for (const part of toolParts()) {
      const summary = summaries.get(part.tool) ?? { tool: part.tool, count: 0, active: false, errors: 0 }
      summary.count += 1
      if (part.state.status === "running" || part.state.status === "pending") summary.active = true
      if (part.state.status === "error") summary.errors += 1
      summaries.set(part.tool, summary)
    }
    return [...summaries.values()]
  })

  // No placeholder rails: an empty conversation shows no side columns at all.
  if (tools().length === 0) return null

  return (
    <aside
      data-component="session-harness-tools"
      class="hidden min-h-0 w-52 shrink-0 flex-col gap-4 overflow-y-auto p-2 xl:flex"
    >
      <RailSection title={language.t("session.harness.tools")}>
        <For each={tools()}>
            {(summary) => (
              <div class="flex min-w-0 items-center gap-2 rounded-[6px] px-1.5 py-1">
                <span
                  class={`size-2 shrink-0 rounded-full ${summary.active ? "bg-icon-warning-base animate-pulse" : summary.errors > 0 ? "bg-icon-critical-base" : "bg-icon-success-base"}`}
                />
                <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-12-regular text-text-base">
                  {summary.tool}
                </span>
                <span class="shrink-0 text-12-regular text-text-weak">×{summary.count}</span>
              </div>
            )}
          </For>
      </RailSection>
    </aside>
  )
}

// Right column of the conversation: subagent runs plus the run metadata a
// user cannot replicate by hand, mirroring the TUI subagent footer.
function useHarnessSummary(messages: Accessor<Message[]>, sessionID: Accessor<string | undefined>) {
  const local = useLocal()
  const sdk = useSDK()
  const navigate = useNavigate()
  const params = useParams<{ serverKey?: string }>()
  const toolParts = useAssistantToolParts(messages)

  const runs = createMemo<SubagentRun[]>(() => {
    const current = sessionID()
    const list: SubagentRun[] = []
    for (const part of toolParts()) {
      if (part.tool !== "task") continue
      const input = part.state.input
      const description = typeof input.description === "string" && input.description ? input.description : part.callID
      const metadata = part.state.status === "pending" ? undefined : part.state.metadata
      const child = metadata?.sessionId
      list.push({
        id: part.callID,
        description,
        status: part.state.status,
        childID: typeof child === "string" && child !== current ? child : undefined,
      })
    }
    return list
  })

  const agent = () => local.agent.current()?.name
  const model = () => local.model.current()
  const userTurns = createMemo(() => messages().filter((message) => message.role === "user").length)

  function openSubagent(childID: string) {
    if (params.serverKey) {
      navigate(sessionHref(requireServerKey(params.serverKey), childID))
      return
    }
    navigate(legacySessionHref(sdk().directory, childID))
  }

  return { runs, agent, model, userTurns, toolCount: () => toolParts().length, openSubagent }
}

export function SessionSubagentsRail(props: {
  messages: Accessor<Message[]>
  sessionID: Accessor<string | undefined>
}) {
  const language = useLanguage()
  const summary = useHarnessSummary(props.messages, props.sessionID)
  const runs = summary.runs

  // No placeholder rails: without subagent runs the whole column (including
  // the system summary) stays hidden instead of occupying space.
  if (runs().length === 0) return null

  return (
    <aside
      data-component="session-harness-subagents"
      class="hidden min-h-0 w-60 shrink-0 flex-col gap-4 overflow-y-auto p-2 xl:flex"
    >
      <RailSection title={language.t("session.harness.subagents")}>
        <For each={runs()}>
            {(run) => (
              <button
                type="button"
                disabled={!run.childID}
                class="flex min-w-0 items-center gap-2 rounded-[6px] px-1.5 py-1 text-left transition-colors hover:bg-surface-base-hover disabled:cursor-default disabled:hover:bg-transparent"
                onClick={() => run.childID && summary.openSubagent(run.childID)}
                title={language.t(`session.harness.status.${run.status}`)}
              >
                <span class={`size-2 shrink-0 rounded-full ${statusDot(run.status)}`} />
                <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-12-regular text-text-base">
                  {run.description}
                </span>
              </button>
            )}
          </For>
      </RailSection>
      <RailSection title={language.t("session.harness.system")}>
        <Show when={summary.agent()}>
          {(name) => (
            <div class="flex min-w-0 items-center gap-2 px-1.5 py-1">
              <span class="shrink-0 text-12-regular text-text-weak">{language.t("session.harness.agent")}</span>
              <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-right text-12-regular text-text-base">
                {name()}
              </span>
            </div>
          )}
        </Show>
        <Show when={summary.model()}>
          {(current) => (
            <div class="flex min-w-0 items-center gap-2 px-1.5 py-1">
              <span class="shrink-0 text-12-regular text-text-weak">{language.t("session.harness.model")}</span>
              <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-right text-12-regular text-text-base">
                {current().provider.id}/{current().id}
              </span>
            </div>
          )}
        </Show>
        <div class="flex min-w-0 items-center gap-2 px-1.5 py-1">
          <span class="shrink-0 text-12-regular text-text-weak">×{summary.userTurns()}</span>
          <span class="shrink-0 text-12-regular text-text-weak">·</span>
          <span class="shrink-0 text-12-regular text-text-weak">×{summary.toolCount()}</span>
        </div>
      </RailSection>
    </aside>
  )
}

// Horizontal footer variant of the same stats, shown inside sub-agent
// sessions instead of the side rails (which stay hidden at parent level).
export function SessionSubagentsFooter(props: {
  messages: Accessor<Message[]>
  sessionID: Accessor<string | undefined>
}) {
  const language = useLanguage()
  const summary = useHarnessSummary(props.messages, props.sessionID)

  if (summary.runs().length === 0) return null

  return (
    <footer
      data-component="session-harness-footer"
      class="flex shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap px-3 py-1.5 text-12-regular text-text-weak"
    >
      <span class="shrink-0 uppercase">{language.t("session.harness.subagents")}</span>
      <For each={summary.runs()}>
        {(run) => (
          <button
            type="button"
            disabled={!run.childID}
            class="flex shrink-0 items-center gap-1.5 transition-colors hover:text-text-base disabled:cursor-default disabled:hover:text-text-weak"
            onClick={() => run.childID && summary.openSubagent(run.childID)}
            title={language.t(`session.harness.status.${run.status}`)}
          >
            <span class={`size-2 shrink-0 rounded-full ${statusDot(run.status)}`} />
            <span class="max-w-48 overflow-hidden text-ellipsis">{run.description}</span>
          </button>
        )}
      </For>
      <Show when={summary.agent()}>
        {(name) => (
          <span class="shrink-0">
            {language.t("session.harness.agent")}: {name()}
          </span>
        )}
      </Show>
      <Show when={summary.model()}>
        {(current) => (
          <span class="shrink-0">
            {language.t("session.harness.model")}: {current().provider.id}/{current().id}
          </span>
        )}
      </Show>
      <span class="shrink-0">
        ×{summary.userTurns()} · ×{summary.toolCount()}
      </span>
    </footer>
  )
}
