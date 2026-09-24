import { For, Show } from "solid-js"
import type { PermissionRequest } from "@spinosa/sdk/v2"
import { Button } from "@spinosa/ui/button"
import { DockPrompt } from "@spinosa/session-ui/dock-prompt"
import { Icon } from "@spinosa/ui/icon"
import { useLanguage } from "@/context/language"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  const jev = () => {
    if (props.request.permission !== "jev") return
    const metadata = props.request.metadata ?? {}
    return {
      count: typeof metadata.count === "number" ? metadata.count : 0,
      query: typeof metadata.query === "string" ? metadata.query : "",
    }
  }
  const title = () => {
    const context = jev()
    if (context) return language.t("notification.permission.jev.title", { count: context.count })
    return language.t("notification.permission.title")
  }

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{title()}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {language.t("ui.permission.deny")}
            </Button>
            <Button
              variant="secondary"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={jev()}>
        {(context) => (
          <>
            <Show when={context().query}>
              <div data-slot="permission-row">
                <span data-slot="permission-spacer" aria-hidden="true" />
                <div data-slot="permission-hint">
                  {language.t("notification.permission.jev.query", { query: context().query })}
                </div>
              </div>
            </Show>
          </>
        )}
      </Show>

      <Show when={props.request.permission !== "jev" && props.request.patterns.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
