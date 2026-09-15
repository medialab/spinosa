import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { Locale } from "../../util/locale"
import { usePathFormatter } from "../../context/path-format"
import { truncateHead } from "../../spinosa/truncate-path"
import type { AssistantMessage, Todo } from "@spinosa/sdk/v2"

export function SessionFooter(props: { sessionID: string }) {
  const { theme } = useTheme()
  const sync = useSync()
  const pathFormatter = usePathFormatter()

  const session = createMemo(() => sync.session.get(props.sessionID))
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const todos = createMemo(() => sync.data.todo[props.sessionID] ?? [])

  const usage = createMemo(() => {
    const last = messages().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) return

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return

    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const pct = model?.limit.context ? `${Math.round((tokens / model.limit.context) * 100)}% used` : undefined
    const money = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

    return {
      tokens: `${Locale.number(tokens)} tokens`,
      pct,
      cost: `${money.format(session()?.cost ?? 0)} spent`,
    }
  })

  const todoSummary = createMemo(() => summarizeTodo(todos()))
  const directory = createMemo(() => {
    const value = session()?.directory
    return value ? pathFormatter.format(value) : undefined
  })

  return (
    <Show when={session()}>
      <box
        flexShrink={0}
        flexDirection="row"
        gap={2}
        paddingTop={0}
        paddingBottom={0}
        paddingLeft={2}
        paddingRight={2}
        border={["top"]}
        borderColor={theme.border}
        backgroundColor={theme.backgroundPanel}
        flexWrap="wrap"
        overflow="hidden"
        justifyContent="center"
      >
        <Show when={todoSummary()}>
          {(todo) => <FooterItem label="Todo" value={formatTodoValue(todo())} />}
        </Show>
        <Show when={usage()}>
          {(item) => (
            <>
              <FooterItem label="Context" value={item().tokens} />
              <Show when={item().pct}>
                {(pct) => <FooterText value={pct()} />}
              </Show>
              <FooterText value={item().cost} />
            </>
          )}
        </Show>
        <Show when={directory()}>
          {(value) => <FooterText value={value()} />}
        </Show>
      </box>
    </Show>
  )
}

/** Pure formatter so the reactive JSX binding stays current as todos advance. */
export function formatTodoValue(summary: { current: number; total: number; content: string }): string {
  return truncateHead(`${summary.current}/${summary.total}: ${summary.content}`, 50)
}

function FooterItem(props: { label: string; value: string }) {  const { theme } = useTheme()
  return (
    <text fg={theme.text} wrapMode="none" overflow="hidden" flexShrink={0}>
      <span style={{ fg: theme.textMuted }}>{props.label}</span> {props.value}
    </text>
  )
}

function FooterText(props: { value: string }) {
  const { theme } = useTheme()
  return <text fg={theme.textMuted} wrapMode="none" overflow="hidden" flexShrink={0}>{props.value}</text>
}

function summarizeTodo(todos: Todo[]) {
  if (todos.length === 0) return
  const currentIndex = todos.findIndex((item) => item.status !== "completed")
  const index = currentIndex >= 0 ? currentIndex : todos.length - 1
  const current = todos[index]
  if (!current) return
  return {
    current: currentIndex >= 0 ? currentIndex + 1 : todos.length,
    total: todos.length,
    content: current.content,
  }
}
