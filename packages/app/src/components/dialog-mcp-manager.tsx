import { Button } from "@spinosa/ui/button"
import { Dialog } from "@spinosa/ui/dialog"
import { List } from "@spinosa/ui/list"
import { Spinner } from "@spinosa/ui/spinner"
import { TextField } from "@spinosa/ui/text-field"
import { useDialog } from "@spinosa/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { createSignal, Show } from "solid-js"

export interface McpServerItem {
  name: string
  status: string
  detail?: string
}

export function DialogMcpManager(props: {
  load: () => Promise<McpServerItem[]>
  busy: () => boolean
  error: () => string | null
  onConnect: (name: string) => Promise<void>
  onDisconnect: (name: string) => Promise<void>
  onOAuth: (name: string) => void
  onRemoveAuth: (name: string) => Promise<void>
  onAdd: (name: string, command: string[] | null, url: string | null) => Promise<void>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [name, setName] = createSignal("")
  const [command, setCommand] = createSignal("")
  const [url, setUrl] = createSignal("")
  const [nonce, setNonce] = createSignal(0)
  const refresh = () => setNonce((v) => v + 1)

  const stop = (e: Event) => e.stopPropagation()

  const submit = () => {
    if (!name().trim() || props.busy()) return
    const cmd = command().trim()
    const remote = url().trim()
    if (!cmd && !remote) return
    void props
      .onAdd(
        name().trim(),
        cmd ? cmd.split(/\s+/).filter(Boolean) : null,
        remote || null,
      )
      .finally(refresh)
  }

  return (
    <Dialog title={language.t("dialog.mcp.title")}>
      <div class="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3 overflow-y-auto">
        <Show when={props.busy()}>
          <div class="flex items-center gap-2 text-sm opacity-70">
            <Spinner />
            {language.t("dialog.mcp.working")}
          </div>
        </Show>
        <List
          class="min-h-24 [&_[data-slot=list-scroll]]:min-h-0"
          key={(x: McpServerItem) => x.name}
          items={() => {
            nonce()
            return props.load()
          }}
          filterKeys={["name"]}
        >
          {(item) => (
            <div class="w-full flex items-center gap-2">
              <div class="flex-1 min-w-0 text-left">
                <div class="truncate font-normal">{item.name}</div>
                <div class="truncate text-xs opacity-60">
                  {item.status}
                  {item.detail ? ` — ${item.detail}` : ""}
                </div>
              </div>
              <div class="flex shrink-0 gap-1" onClick={stop}>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={props.busy()}
                  onClick={() => void props.onConnect(item.name).finally(refresh)}
                >
                  {language.t("dialog.mcp.connect")}
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={props.busy()}
                  onClick={() => void props.onDisconnect(item.name).finally(refresh)}
                >
                  {language.t("dialog.mcp.disconnect")}
                </Button>
                <Show when={item.status === "needs_auth"}>
                  <Button size="small" variant="ghost" disabled={props.busy()} onClick={() => props.onOAuth(item.name)}>
                    {language.t("dialog.mcp.oauth")}
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={props.busy()}
                    onClick={() => void props.onRemoveAuth(item.name).finally(refresh)}
                  >
                    {language.t("dialog.mcp.removeAuth")}
                  </Button>
                </Show>
              </div>
            </div>
          )}
        </List>
        <div class="text-xs uppercase opacity-60">{language.t("dialog.mcp.add.label")}</div>
        <div class="grid grid-cols-2 gap-2">
          <TextField label={language.t("dialog.mcp.add.name")} value={name()} onChange={setName} />
          <TextField
            label={language.t("dialog.mcp.add.command")}
            value={command()}
            onChange={setCommand}
            placeholder={language.t("dialog.mcp.add.command.placeholder")}
          />
        </div>
        <TextField
          label={language.t("dialog.mcp.add.url")}
          value={url()}
          onChange={setUrl}
          placeholder={language.t("dialog.mcp.add.url.placeholder")}
        />
        <Show when={props.error()}>
          <div class="text-sm text-red-500">{props.error()}</div>
        </Show>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
          <Button disabled={props.busy() || !name().trim()} onClick={submit}>
            {language.t("dialog.mcp.add.submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
