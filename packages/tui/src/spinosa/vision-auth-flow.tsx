import { createSignal, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import type { useDialog } from "../ui/dialog"
import type { useSync } from "../context/sync"
import type { useSDK } from "../context/sdk"
import type { useToast } from "../ui/toast"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { DialogVisionModel } from "../component/dialog-vision"
import { normalizeApiKeyInput, apiKeyInputError } from "../util/api-key"
import { isConsoleManagedProvider } from "../util/provider-origin"
import { logAction } from "./log"

export type VisionAuthFlowDeps = {
  dialog: ReturnType<typeof useDialog>
  sync: ReturnType<typeof useSync>
  sdk: ReturnType<typeof useSDK>
  toast: ReturnType<typeof useToast>
}

export type VisionAuthMethod = {
  type: string
  label: string
  prompts?: Array<{
    key: string
    message: string
    placeholder?: string
    type?: string
    options?: Array<{ label: string; value: string; hint?: string }>
    when?: { key: string; op: string; value: string }
  }>
}

/**
 * Shared vision provider/model auth flow (moved out of the onboarding wizard
 * so the background-import monitor can offer the same Change-model power).
 * Order everywhere: 1. select model → 2. auth if needed → 3. confirm.
 * No dummy probes: the first real file transcription is the validation.
 */
export function createVisionAuthFlow(deps: VisionAuthFlowDeps) {
  const { dialog, sync, sdk, toast } = deps
  // App-scope theme for the inline auto/code auth steps.
  const { theme } = useTheme()

  // dialog.replace() fires the previous entry's onClose synchronously. The vision flow
  // chains several replaces (picker → auth → validating → error/success), so an outer
  // picker's onCancel would spuriously reset selection on every forward step. Guard it.
  let suppressVisionCancel = false
  const visionReplace = (
    el: Parameters<typeof dialog.replace>[0],
    onClose?: Parameters<typeof dialog.replace>[1],
    onEscape?: Parameters<typeof dialog.replace>[2],
  ) => {
    suppressVisionCancel = true
    try {
      dialog.replace(el as any, onClose as any, onEscape as any)
    } finally {
      suppressVisionCancel = false
    }
  }
  const wasSuppressedCancel = () => suppressVisionCancel

  const readVisionAuthMethods = (providerId: string): VisionAuthMethod[] | undefined =>
    (sync.data as unknown as { provider_auth?: Record<string, VisionAuthMethod[]> }).provider_auth?.[providerId]

  const isVisionProviderAvailable = (providerId: string): boolean =>
    sync.data.provider.some((p) => p.id === providerId) ||
    sync.data.provider_next.connected.includes(providerId)

  // Loops until a plausible key or cancel — garbage (multi-line paste,
  // file lists, `Bearer ` prefix) can never become a stored credential.
  function promptVisionApiKey(providerId: string): Promise<string | null> {
    return (async (): Promise<string | null> => {
      for (;;) {
        const raw = await new Promise<string | null>((resolve) => {
          visionReplace(
            () => (
              <DialogPrompt
                title={`${providerId} API key`}
                placeholder="Paste API key"
                onConfirm={(v) => resolve(v)}
              />
            ),
            () => resolve(null),
          )
        })
        if (raw == null) return null
        const problem = apiKeyInputError(raw)
        if (!problem) return normalizeApiKeyInput(raw)
        toast.show({ variant: "error", message: `That doesn't look like an API key (${problem}).` })
        logAction("vision", `Vision ${providerId} key rejected (${problem}) — re-prompting`)
      }
    })()
  }

  async function saveVisionApiKey(providerId: string, key: string): Promise<boolean> {
    try {
      await sdk.client.auth.set({ providerID: providerId, auth: { type: "api", key } })
      await sync.refreshProviders()
    } catch {
      // Never report success when the save failed — the user would believe
      // a key is stored that isn't.
      logAction("vision", `Vision key save failed for ${providerId}`)
      toast.show({ variant: "error", message: `Could not save ${providerId} key. Try again.` })
      return false
    }
    logAction("vision", `Vision key saved for ${providerId}`)
    return true
  }

  async function promptVisionOAuthInputs(
    pendingTag: string,
    prompts: NonNullable<VisionAuthMethod["prompts"]>,
  ): Promise<Record<string, string> | null> {
    const inputs: Record<string, string> = {}
    for (const prompt of prompts) {
      if (prompt.when) {
        const v = inputs[prompt.when.key]
        if (v === undefined) continue
        const matches = prompt.when.op === "eq" ? v === prompt.when.value : v !== prompt.when.value
        if (!matches) continue
      }
      if (prompt.type === "select") {
        const val = await new Promise<string | null>((resolve) => {
          visionReplace(
            () => (
              <DialogSelect
                title={prompt.message}
                options={(prompt.options ?? []).map((x) => ({ title: x.label, value: x.value, description: x.hint }))}
                onSelect={(option) => resolve(option.value as string)}
              />
            ),
            () => resolve(null),
          )
        })
        if (val == null) {
          logAction("vision", `Vision ${pendingTag} oauth prompts cancelled`)
          return null
        }
        inputs[prompt.key] = val
        continue
      }
      const val = await new Promise<string | null>((resolve) => {
        visionReplace(
          () => (
            <DialogPrompt title={prompt.message} placeholder={prompt.placeholder} onConfirm={(v) => resolve(v)} />
          ),
          () => resolve(null),
        )
      })
      if (val == null) {
        logAction("vision", `Vision ${pendingTag} oauth prompts cancelled`)
        return null
      }
      inputs[prompt.key] = val
    }
    return inputs
  }

  // Provider-scoped connect menu for vision (mirrors /connect auth for exactly
  // one provider). True when a credential was saved + providers refreshed.
  // Never clears the dialog; callers own the next step. False = cancelled.
  async function ensureProviderAuth(providerId: string): Promise<boolean> {
    // Same guards as the /connect menu: console-managed providers are
    // read-only, and credential-only custom ids need spinosa.json config first.
    if (isConsoleManagedProvider(sync.data.console_state.consoleManagedProviders, providerId)) return false
    if (!sync.data.provider_next.all.some((provider) => provider.id === providerId)) {
      toast.show({
        variant: "info",
        message: `Saved credential for ${providerId}. Configure it in spinosa.json to use it.`,
      })
      return false
    }
    const methods = readVisionAuthMethods(providerId)
    if (methods?.some((m) => m.type === "oauth")) {
      const list = methods as VisionAuthMethod[]
      let methodIndex: number | null = 0
      if (list.length > 1) {
        methodIndex = await new Promise<number | null>((resolve) => {
          visionReplace(
            () => (
              <DialogSelect
                title="Select auth method"
                options={list.map((x, idx) => ({ title: x.label, value: idx }))}
                onSelect={(option) => resolve(option.value as number)}
              />
            ),
            () => resolve(null),
          )
        })
        if (methodIndex == null) {
          logAction("vision", `Vision ${providerId} auth method selection cancelled`)
          return false
        }
      }
      const method = list[methodIndex!]
      if (method.type === "oauth") {
        let inputs: Record<string, string> | undefined
        if (method.prompts?.length) {
          const gathered = await promptVisionOAuthInputs(providerId, method.prompts)
          if (gathered == null) return false
          inputs = gathered
        }
        const result = await sdk.client.provider.oauth.authorize({ providerID: providerId, method: methodIndex!, inputs })
        if ((result as any).error) {
          logAction("vision", `Vision ${providerId} oauth failed: ${JSON.stringify((result as any).error)}`)
          toast.show({ variant: "error", message: JSON.stringify((result as any).error) })
          return false
        }
        const data = (result as any).data as { method: string; url: string; instructions: string } | undefined
        if (data?.method === "code") {
          // Mirrors /connect CodeMethod: wrong codes show inline and stay
          // open for retry; only an explicit cancel backs out.
          return await new Promise<boolean>((resolve) => {
            const CodeStep = () => {
              const { theme } = useTheme()
              const [badCode, setBadCode] = createSignal(false)
              return (
                <DialogPrompt
                  title={method.label}
                  placeholder="Authorization code"
                  onConfirm={async (value) => {
                    const { error } = await sdk.client.provider.oauth.callback({ providerID: providerId, method: methodIndex!, code: value })
                    if (!error) {
                      await sync.refreshProviders()
                      logAction("vision", `Vision ${providerId} oauth connected`)
                      resolve(true)
                      return
                    }
                    logAction("vision", `Vision ${providerId} oauth code invalid`)
                    setBadCode(true)
                  }}
                  description={() => (
                    <box gap={1}>
                      <text fg={theme.textMuted}>{data.instructions}</text>
                      <text fg={theme.primary}>{data.url}</text>
                      <Show when={badCode()}>
                        <text fg={theme.error}>Invalid code</text>
                      </Show>
                    </box>
                  )}
                />
              )
            }
            visionReplace(() => <CodeStep />, () => resolve(false))
          })
        }
        if (data?.method === "auto") {
          return await new Promise<boolean>((resolve) => {
            visionReplace(() => (
              <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>{method.label}</text>
                  <text fg={theme.textMuted} onMouseUp={() => resolve(false)}>esc</text>
                </box>
                <box gap={1}>
                  <text fg={theme.primary}>{data.url}</text>
                  <text fg={theme.textMuted}>{data.instructions}</text>
                </box>
                <text fg={theme.textMuted}>Waiting for authorization...</text>
              </box>
            ), () => resolve(false))
            void (async () => {
              const cb = await sdk.client.provider.oauth.callback({ providerID: providerId, method: methodIndex! })
              if ((cb as any).error) {
                logAction("vision", `Vision ${providerId} oauth auto failed`)
                toast.show({ variant: "error", message: "OAuth authorization failed. Try again." })
                resolve(false)
                return
              }
              await sync.refreshProviders()
              logAction("vision", `Vision ${providerId} oauth connected`)
              resolve(true)
            })()
          })
        }
        await sync.refreshProviders()
        return true
      }
      // API key method for an OAuth-capable provider
      const key = await promptVisionApiKey(providerId)
      if (!key) {
        logAction("vision", `Vision ${providerId} auth cancelled — no key entered`)
        return false
      }
      return saveVisionApiKey(providerId, key)
    }
    const key = await promptVisionApiKey(providerId)
    if (!key) {
      logAction("vision", `Vision ${providerId} auth cancelled — no key entered`)
      return false
    }
    return saveVisionApiKey(providerId, key)
    return true
  }

  // Names the credential actually in use (stored key vs shell env vs OAuth),
  // so a 401 stops being a guessing game. Appended to pipeline failure
  // messages — real-file errors are the validation now (no dummy probes).
  function visionCredentialNote(providerId: string): string {
    const provider = sync.data.provider.find((p) => p.id === providerId) as
      | { source?: string; env?: string[] }
      | undefined
    const source = provider?.source
    const envName = provider?.env?.[0]
    if (source === "api") return " (credential: stored API key — a stored key overrides any shell export)"
    if (source === "env") return ` (credential: ${envName ?? "environment variable"} from shell)`
    if (source === "custom") return " (credential: OAuth login)"
    if (source === "config") return " (credential: spinosa.json provider config)"
    return ""
  }

  return {
    isVisionProviderAvailable,
    ensureProviderAuth,
    visionCredentialNote,
    wasSuppressedCancel,
  }
}

export type VisionAuthFlow = ReturnType<typeof createVisionAuthFlow>
