import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import { DialogModel } from "./dialog-model"

const LOCAL_FORMAT_OPTIONS = [
  { title: "OpenAI Compatible", value: "@ai-sdk/openai-compatible", description: "Ollama, vLLM, oMLX, LM Studio, TGI (/v1)" },
  { title: "Anthropic", value: "@ai-sdk/anthropic", description: "Anthropic API compatible" },
  { title: "OpenAI", value: "@ai-sdk/openai", description: "Direct OpenAI API" },
  { title: "Google", value: "@ai-sdk/google", description: "Generative AI" },
] as const

type LocalFormat = (typeof LOCAL_FORMAT_OPTIONS)[number]["value"]

function normalizeLocalID(value: string): string | undefined {
  const id = value.trim().toLowerCase().replace(/\s+/g, "-").replace(/^@ai-sdk\//, "")
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(id)) return undefined
  return id
}

async function fetchLocalModels(baseURL: string, apiKey?: string): Promise<string[] | null> {
  const clean = baseURL.replace(/\/+$/, "")
  const candidates = [
    `${clean}/models`,
    clean.endsWith("/v1") ? `${clean.replace(/\/v1$/, "")}/api/tags` : null, // ollama native
    `${clean}/api/tags`, // ollama alternative
  ].filter(Boolean) as string[]

  for (const url of candidates) {
    try {
      const controller = new AbortController()
      const tid = setTimeout(() => controller.abort(), 3000)
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (apiKey && apiKey !== "local" && apiKey !== "ollama") headers["Authorization"] = `Bearer ${apiKey}`
      const res = await fetch(url, { headers, signal: controller.signal } as any)
      clearTimeout(tid)
      if (!res.ok) continue
      const json: any = await res.json()
      // OpenAI format: { data: [{id}] } or { models: [...] }
      if (Array.isArray(json?.data)) {
        const ids = json.data.map((m: any) => m.id).filter(Boolean)
        if (ids.length) return ids
      }
      if (Array.isArray(json?.models)) {
        const ids = json.models.map((m: any) => m.name ?? m.id).filter(Boolean)
        if (ids.length) return ids.map((s: string) => s.replace(/:latest$/, ""))
      }
      if (Array.isArray(json)) {
        const ids = json.map((m: any) => m.id ?? m.name).filter(Boolean)
        if (ids.length) return ids
      }
    } catch {
      // ignore, try next
    }
  }
  return null
}

export async function showLocalProviderWizard(opts: {
  dialog: ReturnType<typeof useDialog>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  theme: ReturnType<typeof useTheme>["theme"]
  toast: ReturnType<typeof useToast>
}): Promise<void> {
  const { dialog, sdk, sync, theme, toast } = opts

  // 1. Display name
  const displayName = await DialogPrompt.show(dialog, "Local provider – display name", {
    placeholder: "Ollama Local",
    description: () => <text fg={theme.textMuted}>Human name shown in provider list. Eg. Ollama, vLLM, oMLX</text>,
  })
  if (displayName === null) return
  const name = displayName.trim() || "Local"

  // 2. Provider ID
  const rawID = await DialogPrompt.show(dialog, "Local provider – id", {
    placeholder: "local",
    description: () => <text fg={theme.textMuted}>Lowercase, numbers, hyphen. Used as provider id in spinosa.json</text>,
  })
  if (rawID === null) return
  const providerID = normalizeLocalID(rawID) ?? normalizeLocalID(name)
  if (!providerID) {
    toast.show({ variant: "error", message: "Invalid id – use lowercase letters, numbers, hyphen, underscore" })
    return
  }
  if (sync.data.provider.some((p) => p.id === providerID)) {
    toast.show({ variant: "error", message: `Provider "${providerID}" already exists` })
    return
  }

  // 3. Endpoint
  const endpoint = await DialogPrompt.show(dialog, "Local provider – endpoint", {
    placeholder: "http://localhost:11434/v1",
    description: () => (
      <box gap={1}>
        <text fg={theme.textMuted}>OpenAI-compatible baseURL. Ollama: http://localhost:11434/v1 · vLLM: http://localhost:8000/v1 · oMLX: http://localhost:8080/v1</text>
      </box>
    ),
  })
  if (endpoint === null) return
  const baseURL = endpoint.trim().replace(/\/+$/, "") || "http://localhost:11434/v1"
  try {
    new URL(baseURL)
  } catch {
    toast.show({ variant: "error", message: "Invalid URL" })
    return
  }

  // 4. Format / SDK
  const formatValue = await new Promise<LocalFormat | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogSelect
          title="Local provider – API format"
          options={LOCAL_FORMAT_OPTIONS.map((o) => ({ title: o.title, value: o.value, description: o.description }))}
          onSelect={(opt) => resolve(opt.value as LocalFormat)}
        />
      ),
      () => resolve(null),
    )
  })
  if (!formatValue) return

  // 5. Try auto-fetch models
  let modelIDs: string[] | null = null
  // brief placeholder toast
  toast.show({ variant: "info", message: `Probing ${baseURL}/models…`, duration: 1500 })
  modelIDs = await fetchLocalModels(baseURL, "local")

  if (!modelIDs || modelIDs.length === 0) {
    const manual = await DialogPrompt.show(dialog, "Local provider – models", {
      placeholder: "llama3.1, mistral, gemma2",
      description: () => <text fg={theme.textMuted}>Comma-separated model ids exposed by the endpoint. Leave blank to add later.</text>,
    })
    if (manual === null) return
    const list = manual
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (list.length === 0) {
      // still allow empty – user can add models later via config
      modelIDs = []
    } else modelIDs = list
  } else {
    // Let user confirm / filter fetched list
    const fetched = modelIDs!
    const picked = await new Promise<string[] | null>((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect
            title={`Found ${fetched.length} models – keep all?`}
            options={[
              { title: `Use all ${fetched.length} models`, value: "__all__", description: fetched.slice(0, 3).join(", ") + (fetched.length > 3 ? " …" : "") },
              { title: "Pick manually", value: "__manual__", description: "Enter comma-separated list" },
            ]}
            onSelect={(opt) => resolve(opt.value === "__all__" ? fetched : null)}
          />
        ),
        () => resolve(null),
      )
    })
    if (picked === null) {
      const manual = await DialogPrompt.show(dialog, "Local provider – models", {
        placeholder: fetched.join(", "),
        description: () => <text fg={theme.textMuted}>Fetched: {fetched.join(", ")}. Edit or keep.</text>,
      })
      if (manual === null) return
      const list = manual
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      modelIDs = list.length ? list : modelIDs
    } else {
      modelIDs = picked
    }
  }

  // Build provider config
  const models: Record<string, any> = {}
  for (const id of modelIDs ?? []) {
    const clean = id.trim()
    if (!clean) continue
    models[clean] = { id: clean, name: clean, tool_call: true, limit: { context: 128_000, output: 8_000 } }
  }
  // Ensure at least one placeholder if empty – allows provider to appear
  if (Object.keys(models).length === 0) {
    models["default"] = { id: "default", name: "default", tool_call: true }
  }

  const providerConfig: any = {
    name,
    npm: formatValue,
    options: {
      baseURL,
      apiKey: "local",
      timeout: false as const,
    },
    models,
  }

  try {
    // Prefer global config for machine-local endpoints (persist across workspaces)
    let currentGlobalProvider: Record<string, any> = {}
    try {
      const g: any = await (sdk.client as any).global.config.get()
      currentGlobalProvider = (g?.data as any)?.provider ?? {}
    } catch {
      currentGlobalProvider = (sync.data.config as any)?.provider ?? {}
    }
    const nextProvider = { ...currentGlobalProvider, [providerID]: providerConfig }

    const res: any = await (sdk.client as any).global.config.update({
      config: { provider: nextProvider },
    })
    if (res?.error) {
      toast.show({ variant: "error", message: `Failed to save provider: ${JSON.stringify(res.error)}` })
      return
    }
    await sync.refreshProviders()
    toast.show({ variant: "success", message: `Local provider "${name}" (${providerID}) saved → ${baseURL} [${formatValue}]` })

    // Offer to select a model immediately
    dialog.replace(() => <DialogModel providerID={providerID} />)
  } catch (e) {
    toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e) })
  }
}
