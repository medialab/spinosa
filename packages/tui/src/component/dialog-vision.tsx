import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { map, pipe, flatMap, entries, filter, sortBy } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useSync } from "../context/sync"
import { sortModelOptions } from "./dialog-model"

function isVisionModel(info: unknown): boolean {
  const row = info as { capabilities?: unknown; modalities?: unknown; attachment?: boolean; input?: unknown }
  const cap = (row.capabilities ?? row.modalities) as { input?: unknown } | undefined
  if (cap?.input !== undefined) {
    const input = cap.input
    if (Array.isArray(input) && (input as string[]).includes("image")) return true
    if (input && typeof input === "object" && (input as Record<string, boolean>).image === true) return true
  }
  if (Array.isArray(row.input) && (row.input as string[]).includes("image")) return true
  if (row.attachment === true) return true
  return false
}

export function isVisionProviderSelectable(provider: { id: string; source: string }): boolean {
  // Provider.source is the active credential source; OpenAI "custom" is ChatGPT OAuth.
  return !(provider.id === "openai" && provider.source === "custom")
}

export function DialogVisionModel(props: { onPicked?: (providerID: string, modelID: string) => void; providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")

  const options = createMemo(() => {
    const needle = query().trim()

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "opencode",
        (provider) => provider.name,
      ),
      filter(isVisionProviderSelectable),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => (info as { status?: string }).status !== "deprecated"),
          filter(([_, info]) => isVisionModel(info as never)),
          filter(([_, info]) => (props.providerID ? (info as { providerID?: string }).providerID === props.providerID : true)),
          map(([model, info]) => {
            const typed = info as unknown as { name?: string; release_date?: string; cost?: { input?: number }; capabilities?: { input?: string[] } }
            return {
              value: { providerID: provider.id, modelID: model },
              title: typed.name ?? model,
              releaseDate: typed.release_date ?? "",
              description: provider.name,
              category: provider.name,
              footer: typed.cost?.input === 0 ? "Free" : undefined,
              onSelect() {
                onSelect(provider.id, model)
              },
            }
          }),
          (opts) => sortModelOptions(opts, props.providerID !== undefined),
        ),
      ),
    )

    if (needle) {
      return sortModelOptions(
        fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
        false,
      )
    }

    // If no vision models in catalog (offline), show popular providers to allow connecting
    if (providerOptions.length === 0) {
      const providers = createDialogProviderOptions()()
      return providers.map((opt) => ({
        ...opt,
        category: "Connect a provider for vision",
      }))
    }

    return providerOptions
  })

  const title = createMemo(() => {
    if (props.providerID) {
      const p = sync.data.provider.find((x) => x.id === props.providerID)
      return p ? `Vision — ${p.name}` : "Select vision model"
    }
    return "Select vision model"
  })

  function onSelect(providerID: string, modelID: string) {
    if (props.onPicked) {
      // Let caller handle persistence + auth (onboarding's heavy OAuth flow)
      props.onPicked(providerID, modelID)
      return
    }
    // Persist via same store as chat (recent) + dedicated vision preference
    local.model.set({ providerID, modelID }, { recent: true })
    try {
      local.vision?.set?.({ providerID, modelID })
    } catch {}
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: "Connect provider",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}
