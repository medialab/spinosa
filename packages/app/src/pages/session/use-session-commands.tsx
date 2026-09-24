import { useNavigate } from "@solidjs/router"
import { createSignal } from "solid-js"
import { produce } from "solid-js/store"
import { useCommand, type CommandOption } from "@/context/command"
import { useDialog } from "@spinosa/ui/context/dialog"
import { previewSelectedLines } from "@spinosa/session-ui/pierre/selection-bridge"
import { useFile, selectionFromLines, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { useLayout } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { usePrompt } from "@/context/prompt"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { base64Encode } from "@spinosa/kernel-core/util/encode"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { showToast } from "@/utils/toast"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { findLast } from "@spinosa/kernel-core/util/array"
import { createSessionTabs } from "@/pages/session/helpers"
import { extractPromptFromParts } from "@/utils/prompt"
import { Message, Part, UserMessage } from "@spinosa/sdk/v2"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useSessionArchive } from "@/pages/session/session-archive"
import { createSessionOwnership } from "./session-ownership"
import { useLocal } from "@/context/local"
import { useProviders } from "@/hooks/use-providers"
import { promptStash } from "@/utils/prompt-stash"

export type SessionCommandContext = {
  navigateMessageByOffset: (offset: number) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  focusInput: () => void
  review?: () => boolean
  fileBrowser?: () => boolean
}

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useSessionCommands = (actions: SessionCommandContext) => {
  const command = useCommand()
  const dialog = useDialog()
  const file = useFile()
  const language = useLanguage()
  const permission = usePermission()
  const prompt = usePrompt()
  const platform = usePlatform()
  const server = useServer()
  const global = useGlobal()
  const serverSync = useServerSync()
  const sdk = useSDK()
  const settings = useSettings()
  const sync = useSync()
  const terminal = useTerminal()
  const layout = useLayout()
  const local = useLocal()
  const navigate = useNavigate()
  const { params, sessionKey, tabs, view } = useSessionLayout()
  const sessionOwnership = createSessionOwnership(sessionKey)
  const sessionArchive = useSessionArchive()
  const openDialog = async <T,>(load: () => Promise<T>, show: (value: T) => void) => {
    const owner = sessionOwnership.capture()
    const value = await load()
    owner.run(() => show(value))
  }
  const runCommand = async <T,>(input: {
    owner: ReturnType<ReturnType<typeof createSessionOwnership>["capture"]>
    prompt: T
    request: () => Promise<unknown>
    updatePrompt: (prompt: T) => void
    updateViewport: () => void
  }) => {
    await input.request()
    input.updatePrompt(input.prompt)
    input.owner.run(input.updateViewport)
  }

  const info = () => {
    const id = params.id
    if (!id) return
    return sync().session.get(id)
  }
  const hasReview = () => !!params.id
  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: actions.review,
    hasReview,
    fileBrowser: actions.fileBrowser,
  })
  const activeFileTab = tabState.activeFileTab
  const closableTab = tabState.closableTab
  const shown = settings.visibility.fileTree

  const messages = () => {
    const id = params.id
    if (!id) return []
    return sync().data.message[id] ?? []
  }
  const userMessages = () => messages().filter((m) => m.role === "user") as UserMessage[]
  const visibleUserMessages = () => {
    const revert = info()?.revert?.messageID
    if (!revert) return userMessages()
    const boundary = userMessages().findIndex((message) => message.id === revert)
    return boundary < 0 ? userMessages() : userMessages().slice(0, boundary)
  }

  const showAllFiles = () => {
    if (layout.fileTree.tab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addSelectionToContext = (path: string, selection: FileSelection) => {
    const preview = selectionPreview(path, selection)
    prompt.context.add({ type: "file", path, selection, preview })
  }

  const canAddSelectionContext = () => {
    const tab = activeFileTab()
    if (!tab) return false
    const path = file.pathFromTab(tab)
    if (!path) return false
    return file.selectedLines(path) != null
  }

  const navigateMessageByOffset = actions.navigateMessageByOffset
  const setActiveMessage = actions.setActiveMessage
  const focusInput = actions.focusInput

  const sessionCommand = withCategory(language.t("command.category.session"))
  const fileCommand = withCategory(language.t("command.category.file"))
  const contextCommand = withCategory(language.t("command.category.context"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const terminalCommand = withCategory(language.t("command.category.terminal"))
  const mcpCommand = withCategory(language.t("command.category.mcp"))
  const permissionsCommand = withCategory(language.t("command.category.permissions"))

  const isAutoAcceptActive = () => {
    const sessionID = params.id
    if (sessionID) return permission.isAutoAccepting(sessionID, sdk().directory)
    return permission.isAutoAcceptingDirectory(sdk().directory)
  }
  const write = async (value: string) => {
    const body = typeof document === "undefined" ? undefined : document.body
    if (body) {
      const textarea = document.createElement("textarea")
      textarea.value = value
      textarea.setAttribute("readonly", "")
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      textarea.style.pointerEvents = "none"
      body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand("copy")
      body.removeChild(textarea)
      if (copied) return true
    }

    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard?.writeText) return false
    return clipboard.writeText(value).then(
      () => true,
      () => false,
    )
  }

  const copyShare = async (url: string, existing: boolean) => {
    if (!(await write(url))) {
      showToast({
        title: language.t("toast.session.share.copyFailed.title"),
        variant: "error",
      })
      return
    }

    showToast({
      title: existing ? language.t("session.share.copy.copied") : language.t("toast.session.share.success.title"),
      description: language.t("toast.session.share.success.description"),
      variant: "success",
    })
  }

  const share = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const existing = info()?.share?.url
    if (existing) {
      await copyShare(existing, true)
      return
    }

    const url = await sdk()
      .client.session.share({ sessionID })
      .then((res) => res.data?.share?.url)
      .catch(() => undefined)
    if (!url) {
      showToast({
        title: language.t("toast.session.share.failed.title"),
        description: language.t("toast.session.share.failed.description"),
        variant: "error",
      })
      return
    }

    await copyShare(url, false)
  }

  const unshare = async () => {
    const sessionID = params.id
    if (!sessionID) return

    await sdk()
      .client.session.unshare({ sessionID })
      .then(() =>
        showToast({
          title: language.t("toast.session.unshare.success.title"),
          description: language.t("toast.session.unshare.success.description"),
          variant: "success",
        }),
      )
      .catch(() =>
        showToast({
          title: language.t("toast.session.unshare.failed.title"),
          description: language.t("toast.session.unshare.failed.description"),
          variant: "error",
        }),
      )
  }

  const exportSession = async () => {
    const sessionID = params.id
    if (!sessionID) return
    try {
      const data = await fetchSessionExport({
        sessionID,
        client: sdk().client,
      })
      const filename = sessionExportFilename(data.info)
      downloadSessionExport(filename, data)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  const openFile = () => {
    void openDialog(
      () => import("@/components/dialog-select-file"),
      (x) => dialog.show(() => <x.DialogSelectFile onOpenFile={showAllFiles} />),
    )
  }

  const closeTab = () => {
    const tab = closableTab()
    if (!tab) return
    tabs().close(tab)
  }

  const addSelection = () => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (!path) return

    const range = file.selectedLines(path) as SelectedLineRange | null | undefined
    if (!range) {
      showToast({
        title: language.t("toast.context.noLineSelection.title"),
        description: language.t("toast.context.noLineSelection.description"),
      })
      return
    }

    addSelectionToContext(path, selectionFromLines(range))
  }

  const openTerminal = () => {
    if (terminal.all().length > 0) terminal.new({ focus: true })
    if (terminal.all().length === 0) terminal.requestFocus()
    view().terminal.open()
  }

  const closeTerminal = () => {
    const id = terminal.active()
    if (!id) return
    const last = terminal.all().length === 1
    void terminal.close(id)
    if (last) view().terminal.close()
  }

  const chooseMcp = () => {
    void openDialog(
      () => import("@/components/dialog-select-mcp"),
      (x) => dialog.show(() => <x.DialogSelectMcp />),
    )
  }

  const providers = useProviders(() => sdk().directory)

  const renameSession = async (sessionID: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    await sdk().api.session.rename({ sessionID, title: trimmed })
    sync().set(
      produce((draft) => {
        const index = draft.session.findIndex((item) => item.id === sessionID)
        if (index !== -1) draft.session[index].title = trimmed
      }),
    )
  }

  const deleteSessionByID = async (sessionID: string) => {
    const sessions = sync().data.session
    const target = sessions.find((item) => item.id === sessionID)
    const index = sessions.findIndex((item) => item.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])
    const removed = await sdk()
      .api.session.remove({ sessionID })
      .then(() => true)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: err instanceof Error ? err.message : language.t("common.requestFailed"),
        })
        return false
      })
    if (!removed) return
    const removedIDs = new Set<string>([sessionID])
    const byParent = new Map<string, string[]>()
    for (const item of sync().data.session) {
      if (!item.parentID) continue
      byParent.set(item.parentID, [...(byParent.get(item.parentID) ?? []), item.id])
    }
    const stack = [sessionID]
    while (stack.length > 0) {
      const parentID = stack.pop()
      if (!parentID) continue
      for (const child of byParent.get(parentID) ?? []) {
        if (removedIDs.has(child)) continue
        removedIDs.add(child)
        stack.push(child)
      }
    }
    sessionArchive.navigateAfterRemoval(sessionID, target?.parentID, nextSession?.id)
    sync().set(
      produce((draft) => {
        draft.session = draft.session.filter((item) => !removedIDs.has(item.id))
      }),
    )
  }

  const openRename = (sessionID: string, initial: string) => {
    void openDialog(
      () => import("@/components/dialog-session-rename"),
      (x) =>
        dialog.show(() => (
          <x.DialogSessionRename
            initial={initial}
            onSubmit={(title) => void renameSession(sessionID, title).catch(() => undefined)}
          />
        )),
    )
  }

  const openSessions = () => {
    const sessions = sync().data.session.map((item) => ({ id: item.id, title: item.title || item.id }))
    void openDialog(
      () => import("@/components/dialog-session-list"),
      (x) =>
        dialog.show(() => (
          <x.DialogSessionList
            sessions={sessions}
            currentID={params.id}
            onSelect={(id) => navigate(`/${params.dir}/session/${id}`)}
            onRename={(id) => {
              const target = sessions.find((item) => item.id === id)
              openRename(id, target?.title ?? id)
            }}
            onDelete={(id) => void deleteSessionByID(id)}
          />
        )),
    )
  }

  const openStatus = () => {
    const session = params.id ? info() : undefined
    const model = local.model.current()
    void (async () => {
      const formatters = await sdk()
        .client.formatter.status()
        .then((result) => result.data)
        .then((data) => (data ?? []).map((item) => ({ name: item.name, enabled: item.enabled })))
        .catch(() => undefined)
      void openDialog(
        () => import("@/components/dialog-status"),
        (x) =>
          dialog.show(() => (
            <x.DialogStatus
              info={{
                session: session ? { id: session.id, title: session.title } : undefined,
                model: model ? { providerID: model.provider.id, id: model.id } : null,
                agent: local.agent.current()?.name ?? null,
                connected: providers.connected().map((item) => item.id),
                formatters,
              }}
            />
          )),
      )
    })()
  }

  const openReport = () => {
    void openDialog(
      () => import("@/components/dialog-report"),
      (x) => dialog.show(() => <x.DialogReport issueUrl="https://github.com/medialab/spinosa/issues/new" />),
    )
  }

  const openMessageActions = () => {
    const items = visibleUserMessages()
    const last = items[items.length - 1]
    void openDialog(
      () => import("@/components/dialog-message-actions"),
      (x) =>
        dialog.show(() => (
          <x.DialogMessageActions
            canRevert={items.length > 0}
            onRevert={() => void undo()}
            onCopy={() => {
              if (!last) return
              const parts = sync().data.part[last.id] ?? []
              const text = extractPromptFromParts(parts)
                .map((part) => ("content" in part ? part.content : ""))
                .join("")
              void navigator.clipboard?.writeText(text).catch(() => undefined)
            }}
            onFork={() => fork()}
          />
        )),
    )
  }

  const openExportOptions = () => {
    const sessionID = params.id
    if (!sessionID) return
    void openDialog(
      () => import("@/components/dialog-export-options"),
      (x) =>
        dialog.show(() => (
          <x.DialogExportOptions
            onExport={(format, includeThinking) => void exportWithFormat(sessionID, format, includeThinking)}
          />
        )),
    )
  }

  const exportWithFormat = async (sessionID: string, format: "json" | "markdown" | "text", includeThinking: boolean) => {
    try {
      const data = await fetchSessionExport({ sessionID, client: sdk().client })
      if (format === "json") {
        downloadSessionExport(sessionExportFilename(data.info), data)
      } else if (format === "markdown") {
        const { renderSessionExportMarkdown, downloadSessionExportText } = await import("@/utils/session-export")
        downloadSessionExportText(
          sessionExportFilename(data.info, "md"),
          renderSessionExportMarkdown(data, includeThinking),
          "text/markdown",
        )
      } else {
        const { renderSessionExportText, downloadSessionExportText } = await import("@/utils/session-export")
        downloadSessionExportText(
          sessionExportFilename(data.info, "txt"),
          renderSessionExportText(data, includeThinking),
          "text/plain",
        )
      }
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", {
          filename: sessionExportFilename(data.info),
        }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  const openStash = () => {
    void openDialog(
      () => import("@/components/dialog-prompt-stash"),
      (x) =>
        dialog.show(() => (
          <x.DialogPromptStash
            items={promptStash.list()}
            onRestore={(id) => {
              const item = promptStash.list().find((entry) => entry.id === id)
              if (!item) return
              prompt.set([{ type: "text", content: item.text, start: 0, end: item.text.length }], item.text.length)
              promptStash.remove(id)
            }}
            onDelete={(id) => promptStash.remove(id)}
          />
        )),
    )
  }

  const stashCurrentPrompt = () => {
    const target = prompt.capture()
    const text = target
      .current()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")
    const item = promptStash.push(text)
    if (!item) return
    prompt.reset()
    showToast({
      variant: "success",
      title: language.t("dialog.stash.title"),
      description: text.slice(0, 120),
    })
  }

  const openSkills = () => {
    void openDialog(
      () => import("@/components/dialog-skill-picker"),
      (x) =>
        dialog.show(() => (
          <x.DialogSkillPicker
            load={async () => {
              try {
                const data = await sdk().client.app.skills().then((result) => result.data)
                return (data ?? []).map((skill) => ({ name: skill.name, description: skill.description }))
              } catch (err) {
                showToast({
                  variant: "error",
                  title: language.t("toast.skills.load.failed.title"),
                  description: err instanceof Error ? err.message : undefined,
                })
                return []
              }
            }}
            onPick={(name) => {
              const text = `/${name} `
              prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
              focusInput()
            }}
          />
        )),
    )
  }

  const openMoveSession = () => {
    const sessionID = params.id
    if (!sessionID) return
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    void openDialog(
      () => import("@/components/dialog-move-session"),
      (x) =>
        dialog.show(() => (
          <x.DialogMoveSession
            currentDirectory={sdk().directory}
            busy={busy}
            error={error}
            onMove={(destination, moveChanges) => void moveSessionTo(sessionID, destination, moveChanges, setBusy, setError)}
          />
        )),
    )
  }

  const moveSessionTo = async (
    sessionID: string,
    destination: string,
    moveChanges: boolean,
    setBusy: (value: boolean) => void,
    setError: (value: string | null) => void,
  ) => {
    setBusy(true)
    setError(null)
    try {
      await sdk().client.experimental.controlPlane.moveSession({
        sessionID,
        destination: { directory: destination },
        moveChanges,
      })
      dialog.close()
      showToast({
        variant: "success",
        title: language.t("toast.session.move.success.title"),
        description: destination,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : language.t("toast.session.move.failed.description"))
    } finally {
      setBusy(false)
    }
  }

  const openOrgs = () => {
    const [busy, setBusy] = createSignal(false)
    void openDialog(
      () => import("@/components/dialog-console-orgs"),
      (x) =>
        dialog.show(() => (
          <x.DialogConsoleOrgs
            load={async () => {
              try {
                const data = await sdk().client.experimental.console.listOrgs().then((result) => result.data)
                return (data?.orgs ?? []).map((org) => ({
                  accountID: org.accountID,
                  accountEmail: org.accountEmail,
                  orgID: org.orgID,
                  orgName: org.orgName,
                  active: org.active,
                }))
              } catch (err) {
                showToast({
                  variant: "error",
                  title: language.t("toast.orgs.load.failed.title"),
                  description: err instanceof Error ? err.message : undefined,
                })
                return []
              }
            }}
            busy={busy}
            onSwitch={(accountID, orgID) => void switchOrgTo(accountID, orgID, setBusy)}
          />
        )),
    )
  }

  const switchOrgTo = async (accountID: string, orgID: string, setBusy: (value: boolean) => void) => {
    setBusy(true)
    try {
      await sdk().client.experimental.console.switchOrg({ accountID, orgID })
      dialog.close()
      showToast({ variant: "success", title: language.t("toast.orgs.switch.success.title") })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.orgs.switch.failed.title"),
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  const openTranscribe = () => {
    const current = local.model.current()
    const fallback = providers.defaultModel()
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    const [result, setResult] = createSignal<string | null>(null)
    void openDialog(
      () => import("@/components/dialog-vision-transcribe"),
      (x) =>
        dialog.show(() => (
          <x.DialogVisionTranscribe
            defaultProviderID={current?.provider.id ?? fallback?.providerID ?? ""}
            defaultModelID={current?.id ?? fallback?.modelID ?? ""}
            busy={busy}
            error={error}
            result={result}
            onTranscribe={(file, promptText, providerID, modelID) =>
              void transcribeImage(file, promptText, providerID, modelID, setBusy, setError, setResult)
            }
            onInsert={(text) => {
              prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
              focusInput()
            }}
          />
        )),
    )
  }

  const transcribeImage = async (
    file: File,
    promptText: string,
    providerID: string,
    modelID: string,
    setBusy: (value: boolean) => void,
    setError: (value: string | null) => void,
    setResult: (value: string | null) => void,
  ) => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      if (!providerID || !modelID) throw new Error(language.t("dialog.vision.model.required"))
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ""
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      const data = await sdk()
        .client.provider.vision.transcribe({
          providerID,
          modelID,
          prompt: promptText || language.t("dialog.vision.prompt.default"),
          image: { mime: file.type || "image/png", data: btoa(binary) },
        })
        .then((response) => response.data)
      setResult(data ?? "")
    } catch (err) {
      setError(err instanceof Error ? err.message : language.t("dialog.vision.failed"))
    } finally {
      setBusy(false)
    }
  }

  const openChildren = () => {
    const sessionID = params.id
    if (!sessionID) return
    const [busy, setBusy] = createSignal(false)
    void openDialog(
      () => import("@/components/dialog-session-children"),
      (x) =>
        dialog.show(() => (
          <x.DialogSessionChildren
            load={async () => {
              try {
                const data = await sdk().client.session.children({ sessionID }).then((result) => result.data)
                return (data ?? []).map((child) => ({ id: child.id, title: child.title ?? child.id }))
              } catch (err) {
                showToast({
                  variant: "error",
                  title: language.t("toast.children.load.failed.title"),
                  description: err instanceof Error ? err.message : undefined,
                })
                return []
              }
            }}
            busy={busy}
            onOpen={(id) => navigate(`/${params.dir}/session/${id}`)}
            onAbort={(id) => abortChildSession(id, setBusy)}
          />
        )),
    )
  }

  const abortChildSession = async (sessionID: string, setBusy: (value: boolean) => void) => {
    setBusy(true)
    try {
      await sdk().client.session.abort({ sessionID })
      showToast({ variant: "success", title: language.t("toast.children.abort.success.title") })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.children.abort.failed.title"),
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  const openProject = async () => {
    const conn = server.current
    if (!conn) return
    try {
      const projects = await sdk().client.project.list().then((result) => result.data)
      const target =
        (projects ?? []).find((item) => item.worktree === sdk().directory) ?? (projects ?? [])[0]
      if (!target) {
        showToast({ variant: "error", title: language.t("toast.project.missing.title") })
        return
      }
      void openDialog(
        () => import("@/components/dialog-edit-project"),
        (x) =>
          dialog.show(() => (
            <x.DialogEditProject server={conn} project={{ ...target, expanded: false }} />
          )),
      )
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.project.load.failed.title"),
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const openFind = () => {
    const [busy, setBusy] = createSignal(false)
    const [results, setResults] = createSignal<import("@/components/dialog-find").FindHit[] | null>(null)
    const [searched, setSearched] = createSignal(false)
    void openDialog(
      () => import("@/components/dialog-find"),
      (x) =>
        dialog.show(() => (
          <x.DialogFind
            busy={busy}
            results={results}
            searched={searched}
            onSearch={(query, kind) => void runFind(query, kind, setBusy, setResults, setSearched)}
            onCopy={(hit) => {
              void navigator.clipboard?.writeText(hit.detail ?? hit.title).catch(() => undefined)
              showToast({ variant: "success", title: language.t("toast.find.copied.title") })
            }}
          />
        )),
    )
  }

  const runFind = async (
    query: string,
    kind: import("@/components/dialog-find").FindKind,
    setBusy: (value: boolean) => void,
    setResults: (value: import("@/components/dialog-find").FindHit[]) => void,
    setSearched: (value: boolean) => void,
  ) => {
    setBusy(true)
    setSearched(true)
    try {
      if (kind === "text") {
        const data = await sdk().client.find.text({ pattern: query }).then((result) => result.data)
        setResults(
          (data ?? []).map((match, index) => ({
            id: `${match.path.text}:${match.line_number}:${index}`,
            title: `${match.path.text}:${match.line_number}`,
            detail: match.lines.text,
          })),
        )
      } else if (kind === "files") {
        const data = await sdk().client.find.files({ query }).then((result) => result.data)
        setResults((data ?? []).map((path) => ({ id: path, title: path })))
      } else {
        const data = await sdk().client.find.symbols({ query }).then((result) => result.data)
        setResults(
          (data ?? []).map((symbol, index) => ({
            id: `${symbol.location.uri}:${symbol.name}:${index}`,
            title: symbol.name,
            detail: symbol.location.uri,
          })),
        )
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.find.failed.title"),
        description: err instanceof Error ? err.message : undefined,
      })
      setResults([])
    } finally {
      setBusy(false)
    }
  }

  const openVcs = () => {
    const [busy, setBusy] = createSignal(false)
    const [files, setFiles] = createSignal<import("@/components/dialog-vcs").VcsFileItem[] | null>(null)
    const [unavailable, setUnavailable] = createSignal<string | null>(null)
    const [error, setError] = createSignal<string | null>(null)
    void openDialog(
      () => import("@/components/dialog-vcs"),
      (x) =>
        dialog.show(() => (
          <x.DialogVcs
            busy={busy}
            files={files}
            unavailable={unavailable}
            error={error}
            onApply={(patch) => void applyVcsPatch(patch, setBusy, setError)}
            onDownloadDiff={() => void downloadVcsDiff(setBusy, setError)}
          />
        )),
    )
    void (async () => {
      setBusy(true)
      try {
        const status = await sdk().client.vcs.status().then((result) => result.data)
        if (!status || status._tag === "unavailable") {
          setUnavailable(language.t("dialog.vcs.unavailable"))
          return
        }
        setFiles(status.files.map((item) => ({ ...item })))
      } catch (err) {
        setError(err instanceof Error ? err.message : language.t("dialog.vcs.failed"))
      } finally {
        setBusy(false)
      }
    })()
  }

  const applyVcsPatch = async (
    patch: string,
    setBusy: (value: boolean) => void,
    setError: (value: string | null) => void,
  ) => {
    setBusy(true)
    setError(null)
    try {
      const result = await sdk().client.vcs.apply({ patch }).then((response) => response.data)
      if (result?.applied) {
        dialog.close()
        showToast({ variant: "success", title: language.t("toast.vcs.apply.success.title") })
      } else {
        setError(language.t("toast.vcs.apply.failed.description"))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : language.t("toast.vcs.apply.failed.description"))
    } finally {
      setBusy(false)
    }
  }

  const downloadVcsDiff = async (
    setBusy: (value: boolean) => void,
    setError: (value: string | null) => void,
  ) => {
    setBusy(true)
    setError(null)
    try {
      const diff = await sdk().client.vcs.diff({ mode: "git" }).then((result) => result.data)
      const { downloadSessionExportText } = await import("@/utils/session-export")
      const parts = Array.isArray(diff) ? diff : [diff]
      const text = parts
        .map((part) => (typeof part === "string" ? part : (part.patch ?? "")))
        .filter(Boolean)
        .join("\n")
      downloadSessionExportText("changes.diff", text || language.t("dialog.vcs.empty"), "text/plain")
    } catch (err) {
      setError(err instanceof Error ? err.message : language.t("dialog.vcs.failed"))
    } finally {
      setBusy(false)
    }
  }

  const openMcpManager = () => {
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    void openDialog(
      () => import("@/components/dialog-mcp-manager"),
      (x) =>
        dialog.show(() => (
          <x.DialogMcpManager
            load={async () => {
              try {
                const data = await sdk().client.mcp.status().then((result) => result.data)
                return Object.entries(data ?? {}).map(([name, item]) => ({
                  name,
                  status: item.status,
                  detail: "error" in item && item.error ? String(item.error) : undefined,
                }))
              } catch (err) {
                setError(err instanceof Error ? err.message : language.t("dialog.mcp.failed"))
                return []
              }
            }}
            busy={busy}
            error={error}
            onConnect={(name) => mcpAct(name, "connect", setBusy, setError)}
            onDisconnect={(name) => mcpAct(name, "disconnect", setBusy, setError)}
            onOAuth={(name) => void mcpConnectOAuth(name)}
            onRemoveAuth={(name) => mcpRemoveAuth(name, setBusy, setError)}
            onAdd={(name, command, url) => mcpAdd(name, command, url, setBusy, setError)}
          />
        )),
    )
  }

  const mcpAct = async (
    name: string,
    action: "connect" | "disconnect",
    setBusy: (value: boolean) => void,
    setError: (value: string | null) => void,
  ) => {
    setBusy(true)
    setError(null)
    try {
      if (action === "connect") await sdk().client.mcp.connect({ name })
      else await sdk().client.mcp.disconnect({ name })
      showToast({
        variant: "success",
        title:
          action === "connect"
            ? language.t("toast.mcp.connect.success.title")
            : language.t("toast.mcp.disconnect.success.title"),
      })
    } catch (err) {
      const failed =
        action === "connect"
          ? language.t("toast.mcp.connect.failed.title")
          : language.t("toast.mcp.disconnect.failed.title")
      const message = err instanceof Error ? err.message : failed
      setError(message)
      showToast({ variant: "error", title: failed, description: message })
    } finally {
      setBusy(false)
    }
  }

  const mcpRemoveAuth = async (
    name: string,
    setBusy: (value: boolean) => void,
    setError: (value: string | null) => void,
  ) => {
    setBusy(true)
    setError(null)
    try {
      await sdk().client.mcp.auth.remove({ name })
      showToast({ variant: "success", title: language.t("toast.mcp.removeAuth.success.title") })
    } catch (err) {
      const message = err instanceof Error ? err.message : language.t("toast.mcp.removeAuth.failed.title")
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const mcpConnectOAuth = async (name: string) => {
    try {
      const data = await sdk().client.mcp.auth.start({ name }).then((result) => result.data)
      if (data?.authorizationUrl) platform.openExternal(data.authorizationUrl)
      else showToast({ variant: "error", title: language.t("toast.mcp.oauth.failed.title") })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.mcp.oauth.failed.title"),
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const mcpAdd = async (
    name: string,
    command: string[] | null,
    url: string | null,
    setBusy: (value: boolean) => void,
    setError: (value: string | null) => void,
  ) => {
    setBusy(true)
    setError(null)
    try {
      await sdk().client.mcp.add({
        name,
        config: command ? { type: "local", command } : { type: "remote", url: url ?? "" },
      })
      showToast({ variant: "success", title: language.t("toast.mcp.add.success.title") })
    } catch (err) {
      const message = err instanceof Error ? err.message : language.t("toast.mcp.add.failed.title")
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const openSavedPermissions = () => {
    const [busy, setBusy] = createSignal(false)
    void openDialog(
      () => import("@/components/dialog-saved-permissions"),
      (x) =>
        dialog.show(() => (
          <x.DialogSavedPermissions
            load={async () => {
              try {
                const raw = await sdk().client.v2.permission.saved.list().then((result) => result.data)
                const items = Array.isArray(raw) ? raw : (raw?.data ?? [])
                return items.map((item) => ({
                  id: item.id,
                  projectID: item.projectID,
                  action: item.action,
                  resource: item.resource,
                }))
              } catch (err) {
                showToast({
                  variant: "error",
                  title: language.t("toast.permissions.load.failed.title"),
                  description: err instanceof Error ? err.message : undefined,
                })
                return []
              }
            }}
            busy={busy}
            onRemove={(id) => removeSavedPermission(id, setBusy)}
          />
        )),
    )
  }

  const removeSavedPermission = async (id: string, setBusy: (value: boolean) => void) => {
    setBusy(true)
    try {
      await sdk().client.v2.permission.saved.remove({ id })
      showToast({ variant: "success", title: language.t("toast.permissions.remove.success.title") })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.permissions.remove.failed.title"),
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  const runUpgrade = async () => {
    try {
      const data = await sdk().client.global.upgrade().then((result) => result.data)
      if (data && data.success) {
        showToast({
          variant: "success",
          title: language.t("toast.upgrade.success.title"),
          description: data.version,
        })
      } else {
        showToast({
          variant: "error",
          title: language.t("toast.upgrade.failed.title"),
          description: data && !data.success ? data.error : undefined,
        })
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.upgrade.failed.title"),
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const openMarkdownViewer = (path: string, presetText?: string) => {
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    const [text, setText] = createSignal<string | null>(presetText ?? null)
    void openDialog(
      () => import("@/components/dialog-markdown-viewer"),
      (x) =>
        dialog.show(() => (
          <x.DialogMarkdownViewer
            path={path}
            busy={busy}
            error={error}
            text={text}
            onExport={() => void exportViewerMd(path, text())}
            onPrint={() => window.print()}
          />
        )),
    )
    if (presetText !== undefined) return
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const data = await sdk().client.file.read({ path }).then((result) => result.data)
        if (!data || data.type !== "text") {
          setError(language.t("dialog.md.binary"))
          return
        }
        setText(data.content)
      } catch (err) {
        setError(err instanceof Error ? err.message : language.t("dialog.md.failed"))
      } finally {
        setBusy(false)
      }
    })()
  }

  const openDroppedMarkdown = async (file: File) => {
    if (!/\.markdown?$/i.test(file.name.trim())) return false
    try {
      const content = await file.text()
      openMarkdownViewer(file.name, content)
      return true
    } catch {
      return false
    }
  }

  const openMarkdownHref = (href: string) => {
    try {
      if (/^(https?|mailto|tel):/i.test(href)) return false
      const clean = href.split("#")[0].split("?")[0]
      if (!clean) return false
      let decoded = clean
      try {
        decoded = decodeURIComponent(clean)
      } catch {
        /* keep raw */
      }
      const absolute = decoded.startsWith("file://")
        ? decoded.slice("file://".length)
        : decoded.startsWith("/")
          ? decoded
          : `${sdk().directory}/${decoded}`
      if (!/\.markdown?$/i.test(absolute.trim())) return false
      openMarkdownViewer(absolute)
      return true
    } catch {
      return false
    }
  }

  const exportViewerMd = async (path: string, content: string | null) => {
    if (!content) return
    const { downloadSessionExportText } = await import("@/utils/session-export")
    const base = path.split("/").pop() ?? "document"
    downloadSessionExportText(base.endsWith(".md") ? base : `${base}.md`, content, "text/markdown")
    showToast({ variant: "success", title: language.t("toast.md.export.success.title") })
  }

  const openViewPicker = () => {
    void openDialog(
      () => import("@/components/dialog-select-file"),
      (x) =>
        dialog.show(() => (
          <x.DialogSelectFile
            onOpenFile={(path) => {
              if (/\.markdown?$/i.test(path.trim())) openMarkdownViewer(path)
              else showToast({ variant: "error", title: language.t("toast.view.notMarkdown.title") })
            }}
          />
        )),
    )
  }

  const openWorkspaceSwitch = () => {
    const items = new Map<string, { worktree: string; name: string; detail: string }>()
    const recent = server.current ? global.ensureServerCtx(server.current).projects.recentlyOpened() : []
    for (const project of recent) {
      items.set(project.worktree, {
        worktree: project.worktree,
        name: project.name || project.worktree.split("/").pop() || project.worktree,
        detail: project.worktree,
      })
    }
    for (const project of serverSync().data.project ?? []) {
      if (items.has(project.worktree)) continue
      items.set(project.worktree, {
        worktree: project.worktree,
        name: project.name || project.worktree.split("/").pop() || project.worktree,
        detail: project.worktree,
      })
    }
    void openDialog(
      () => import("@/components/dialog-workspace-switch"),
      (x) =>
        dialog.show(() => (
          <x.DialogWorkspaceSwitch
            items={[...items.values()]}
            currentDirectory={sdk().directory}
            onSelect={(worktree) => navigate(`/${base64Encode(worktree)}/session`)}
            onPickNew={() => {
              dialog.close()
              navigate("/")
            }}
          />
        )),
    )
  }

  const toggleAutoAccept = () => {    const sessionID = params.id
    if (sessionID) permission.toggleAutoAccept(sessionID, sdk().directory)
    else permission.toggleAutoAcceptDirectory(sdk().directory)

    const active = sessionID
      ? permission.isAutoAccepting(sessionID, sdk().directory)
      : permission.isAutoAcceptingDirectory(sdk().directory)
    showToast({
      title: active
        ? language.t("toast.permissions.autoaccept.on.title")
        : language.t("toast.permissions.autoaccept.off.title"),
      description: active
        ? language.t("toast.permissions.autoaccept.on.description")
        : language.t("toast.permissions.autoaccept.off.description"),
    })
  }

  const undo = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const owner = sessionOwnership.capture()
    const session = sdk().api.session
    const directory = sdk().directory
    const promptSession = prompt.capture()
    const revert = info()?.revert?.messageID
    const messages = userMessages()
    const boundary = revert ? messages.findIndex((message) => message.id === revert) : messages.length
    if (boundary < 0) return
    const message = messages[boundary - 1]
    if (!message) return
    const parts = sync().data.part[message.id]

    if (sync().data.session_working(sessionID)) {
      await session.interrupt({ sessionID }).catch(() => {})
    }

    await runCommand({
      owner,
      prompt: promptSession,
      request: () => session.revert.stage({ sessionID, messageID: message.id }),
      updatePrompt: (promptSession) => {
        if (parts) promptSession.set(extractPromptFromParts(parts, { directory }))
      },
      updateViewport: () => setActiveMessage(messages[boundary - 2]),
    })
  }

  const redo = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const owner = sessionOwnership.capture()
    const session = sdk().api.session
    const messages = userMessages()
    const promptSession = prompt.capture()

    const revertMessageID = info()?.revert?.messageID
    if (!revertMessageID) return

    const boundary = messages.findIndex((message) => message.id === revertMessageID)
    if (boundary < 0) return
    const next = messages[boundary + 1]
    if (!next) {
      await runCommand({
        owner,
        prompt: promptSession,
        request: () => session.revert.clear({ sessionID }),
        updatePrompt: (promptSession) => promptSession.reset(),
        updateViewport: () => setActiveMessage(messages.at(-1)),
      })
      return
    }

    await runCommand({
      owner,
      prompt: promptSession,
      request: () => session.revert.stage({ sessionID, messageID: next.id }),
      updatePrompt: () => undefined,
      updateViewport: () => setActiveMessage(messages[boundary]),
    })
  }

  const compact = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const model = local.model.current()
    if (!model) {
      showToast({
        title: language.t("toast.model.none.title"),
        description: language.t("toast.model.none.description"),
      })
      return
    }

    await sdk().api.session.compact({
      sessionID,
      model: { providerID: model.provider.id, modelID: model.id },
    })
  }

  const fork = () => {
    void openDialog(
      () => import("@/components/dialog-fork"),
      (x) => dialog.show(() => <x.DialogFork />),
    )
  }

  const shareCmds = () => {
    if (sync().data.config.share === "disabled") return []
    return [
      sessionCommand({
        id: "session.share",
        title: info()?.share?.url ? language.t("session.share.copy.copyLink") : language.t("command.session.share"),
        description: info()?.share?.url
          ? language.t("toast.session.share.success.description")
          : language.t("command.session.share.description"),
        slash: "share",
        disabled: !params.id,
        onSelect: share,
      }),
      sessionCommand({
        id: "session.unshare",
        title: language.t("command.session.unshare"),
        description: language.t("command.session.unshare.description"),
        slash: "unshare",
        disabled: !params.id || !info()?.share?.url,
        onSelect: unshare,
      }),
    ]
  }

  const sessionCmds = () => [
    sessionCommand({
      id: "session.new",
      title: language.t("command.session.new"),
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: (source) => {
        if (settings.general.newLayoutDesigns()) {
          command.trigger("tab.new", source)
          return
        }
        navigate(`/${params.dir}/session`)
      },
    }),
    sessionCommand({
      id: "session.undo",
      title: language.t("command.session.undo"),
      description: language.t("command.session.undo.description"),
      slash: "undo",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: undo,
    }),
    sessionCommand({
      id: "session.redo",
      title: language.t("command.session.redo"),
      description: language.t("command.session.redo.description"),
      slash: "redo",
      disabled: !params.id || !info()?.revert?.messageID,
      onSelect: redo,
    }),
    sessionCommand({
      id: "session.compact",
      title: language.t("command.session.compact"),
      description: language.t("command.session.compact.description"),
      slash: "compact",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: compact,
    }),
    sessionCommand({
      id: "session.fork",
      title: language.t("command.session.fork"),
      description: language.t("command.session.fork.description"),
      slash: "fork",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: fork,
    }),
    sessionCommand({
      id: "session.export",
      title: language.t("command.session.export"),
      description: language.t("command.session.export.description"),
      disabled: !params.id,
      onSelect: exportSession,
    }),
    sessionCommand({
      id: "session.archive",
      title: language.t("command.session.archive"),
      keybind: "mod+shift+backspace",
      disabled: !params.id,
      onSelect: () => {
        const id = params.id
        if (id) void sessionArchive.archive(id)
      },
    }),
  ]

  const fileCmds = () => {
    const tab = closableTab()
    return [
      fileCommand({
        id: "file.open",
        title: language.t("command.file.open"),
        description: language.t("palette.search.placeholder"),
        keybind: "mod+p",
        slash: "open",
        onSelect: openFile,
      }),
      tab &&
        fileCommand({
          id: "tab.close",
          title: language.t("command.tab.close"),
          keybind: "mod+w",
          onSelect: closeTab,
        }),
    ].filter((v) => !!v)
  }

  const contextCmds = () => [
    contextCommand({
      id: "context.addSelection",
      title: language.t("command.context.addSelection"),
      description: language.t("command.context.addSelection.description"),
      keybind: "mod+shift+l",
      disabled: !canAddSelectionContext(),
      onSelect: addSelection,
    }),
  ]

  const viewCmds = () => [
    viewCommand({
      id: "terminal.toggle",
      title: language.t("command.terminal.toggle"),
      keybind: "ctrl+`",
      slash: "terminal",
      onSelect: () => {
        if (view().terminal.opened()) {
          terminal.cancelFocus()
          view().terminal.close()
          return
        }
        terminal.requestFocus(terminal.active())
        view().terminal.open()
      },
    }),
    viewCommand({
      id: "review.toggle",
      title: language.t("command.review.toggle"),
      keybind: "mod+shift+r",
      onSelect: () => view().reviewPanel.toggle(),
    }),
    ...(shown()
      ? [
          viewCommand({
            id: "fileTree.toggle",
            title: language.t("command.fileTree.toggle"),
            keybind: "mod+\\",
            onSelect: () => layout.fileTree.toggle(),
          }),
        ]
      : []),
    viewCommand({
      id: "input.focus",
      title: language.t("command.input.focus"),
      keybind: "ctrl+l",
      onSelect: focusInput,
    }),
  ]

  const terminalCmds = () => [
    terminalCommand({
      id: "terminal.close",
      title: language.t("terminal.close"),
      keybind: "mod+w",
      hidden: true,
      when: (event) => event.target instanceof Element && !!event.target.closest('[data-component="terminal"]'),
      onSelect: closeTerminal,
    }),
    terminalCommand({
      id: "terminal.new",
      title: language.t("command.terminal.new"),
      description: language.t("command.terminal.new.description"),
      keybind: "ctrl+alt+t",
      onSelect: openTerminal,
    }),
  ]

  const messageCmds = () => [
    sessionCommand({
      id: "message.first",
      title: language.t("command.message.first"),
      keybind: "mod+alt+home",
      disabled: !params.id,
      onSelect: () => {
        const first = visibleUserMessages()[0]
        if (first) setActiveMessage(first)
      },
    }),
    sessionCommand({
      id: "message.last",
      title: language.t("command.message.last"),
      keybind: "mod+alt+end",
      disabled: !params.id,
      onSelect: () => {
        const items = visibleUserMessages()
        const last = items[items.length - 1]
        if (last) setActiveMessage(last)
      },
    }),
    sessionCommand({
      id: "message.lastUser",
      title: language.t("command.message.lastUser"),
      keybind: "mod+alt+u",
      disabled: !params.id,
      onSelect: () => {
        const items = visibleUserMessages()
        const last = items[items.length - 1]
        if (last) setActiveMessage(last)
      },
    }),
    sessionCommand({
      id: "message.previous",
      title: language.t("command.message.previous"),
      description: language.t("command.message.previous.description"),
      keybind: "mod+alt+[",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(-1),
    }),
    sessionCommand({
      id: "message.next",
      title: language.t("command.message.next"),
      description: language.t("command.message.next.description"),
      keybind: "mod+alt+]",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(1),
    }),
    sessionCommand({
      id: "message.actions",
      title: language.t("dialog.message.actions.title"),
      disabled: !params.id,
      onSelect: openMessageActions,
    }),
  ]

  const thinkingCmds = () => [
    sessionCommand({
      id: "session.thinking",
      title: language.t("command.session.thinking"),
      slash: "thinking",
      disabled: !params.id,
      onSelect: () => settings.general.setShowThinking(!settings.general.showThinking()),
    }),
  ]

  const sessionOpsCmds = () => [
    sessionCommand({
      id: "session.rename",
      title: language.t("dialog.session.rename.title"),
      keybind: "ctrl+r",
      slash: "rename",
      disabled: !params.id,
      onSelect: () => {
        if (params.id) openRename(params.id, info()?.title ?? params.id)
      },
    }),
    sessionCommand({
      id: "session.delete",
      title: language.t("session.delete.title"),
      keybind: "ctrl+d",
      disabled: !params.id,
      onSelect: () => {
        if (params.id) void deleteSessionByID(params.id)
      },
    }),
    ...sync().data.session.slice(0, 9).map((item, index) =>
      sessionCommand({
        id: `session.quickSwitch.${index + 1}`,
        title: item.title || item.id,
        keybind: `alt+shift+${index + 1}`,
        hidden: true,
        when: (event) =>
          event.target instanceof Element && !event.target.closest("[contenteditable],input,textarea"),
        onSelect: () => navigate(`/${params.dir}/session/${item.id}`),
      }),
    ),
  ]

  const dialogCmds = () => [
    sessionCommand({
      id: "dialog.help",
      title: language.t("dialog.help.title"),
      slash: "help",
      onSelect: () => {
        void openDialog(
          () => import("@/components/dialog-help"),
          (x) => dialog.show(() => <x.DialogHelp />),
        )
      },
    }),
    sessionCommand({
      id: "dialog.status",
      title: language.t("dialog.status.title"),
      slash: "status",
      onSelect: openStatus,
    }),
    sessionCommand({
      id: "dialog.report",
      title: language.t("dialog.report.title"),
      slash: "report",
      onSelect: openReport,
    }),
    sessionCommand({
      id: "dialog.sessions",
      title: language.t("dialog.session.list.title"),
      slash: "sessions",
      onSelect: openSessions,
    }),
    sessionCommand({
      id: "dialog.export",
      title: language.t("dialog.export.title"),
      slash: "export",
      disabled: !params.id,
      onSelect: openExportOptions,
    }),
    sessionCommand({
      id: "dialog.stash",
      title: language.t("dialog.stash.title"),
      slash: "stash",
      onSelect: openStash,
    }),
    sessionCommand({
      id: "prompt.stash.push",
      title: language.t("dialog.stash.push"),
      onSelect: stashCurrentPrompt,
    }),
  ]

  const mcpCmds = () => [
    mcpCommand({
      id: "mcp.toggle",
      title: language.t("command.mcp.toggle"),
      description: language.t("command.mcp.toggle.description"),
      keybind: "mod+;",
      slash: "mcp",
      onSelect: chooseMcp,
    }),
  ]

  const permissionsCmds = () => [
    permissionsCommand({
      id: "permissions.autoaccept",
      title: isAutoAcceptActive()
        ? language.t("command.permissions.autoaccept.disable")
        : language.t("command.permissions.autoaccept.enable"),
      keybind: "mod+shift+a",
      disabled: false,
      onSelect: toggleAutoAccept,
    }),
  ]

  const tier2BCmds = () => [
    sessionCommand({
      id: "dialog.project",
      title: language.t("dialog.project.edit.title"),
      slash: "project",
      onSelect: () => void openProject(),
    }),
    sessionCommand({
      id: "dialog.find",
      title: language.t("dialog.find.title"),
      slash: "find",
      onSelect: openFind,
    }),
    sessionCommand({
      id: "dialog.vcs",
      title: language.t("dialog.vcs.title"),
      slash: "vcs",
      onSelect: openVcs,
    }),
    sessionCommand({
      id: "dialog.mcp.manager",
      title: language.t("dialog.mcp.title"),
      slash: "mcp-add",
      onSelect: openMcpManager,
    }),
    sessionCommand({
      id: "dialog.permissions",
      title: language.t("dialog.permissions.title"),
      slash: "permissions",
      onSelect: openSavedPermissions,
    }),
    sessionCommand({
      id: "global.upgrade",
      title: language.t("command.upgrade.title"),
      slash: "upgrade",
      onSelect: () => void runUpgrade(),
    }),
    sessionCommand({
      id: "dialog.md.view",
      title: language.t("dialog.md.title"),
      slash: "view",
      onSelect: openViewPicker,
    }),
    sessionCommand({
      id: "dialog.workspaces",
      title: language.t("dialog.workspaces.title"),
      slash: "workspaces",
      onSelect: openWorkspaceSwitch,
    }),
    sessionCommand({
      id: "session.warp",
      title: language.t("dialog.workspaces.title"),
      slash: "warp",
      onSelect: openWorkspaceSwitch,
    }),
  ]

  const tier2ACmds = () => [
    sessionCommand({
      id: "dialog.skills",
      title: language.t("dialog.skills.title"),
      slash: "skills",
      onSelect: openSkills,
    }),
    sessionCommand({
      id: "dialog.move",
      title: language.t("dialog.move.title"),
      slash: "move",
      disabled: !params.id,
      onSelect: openMoveSession,
    }),
    sessionCommand({
      id: "dialog.orgs",
      title: language.t("dialog.orgs.title"),
      slash: "orgs",
      onSelect: openOrgs,
    }),
    sessionCommand({
      id: "dialog.transcribe",
      title: language.t("dialog.vision.title"),
      slash: "transcribe",
      onSelect: openTranscribe,
    }),
    sessionCommand({
      id: "dialog.children",
      title: language.t("dialog.children.title"),
      slash: "children",
      disabled: !params.id,
      onSelect: openChildren,
    }),
  ]

  command.register("session", () => [
    ...sessionCmds(),
    ...shareCmds(),
    ...fileCmds(),
    ...contextCmds(),
    ...viewCmds(),
    ...terminalCmds(),
    ...messageCmds(),
    ...mcpCmds(),
    ...permissionsCmds(),
    ...thinkingCmds(),
    ...sessionOpsCmds(),
    ...dialogCmds(),
    ...tier2ACmds(),
    ...tier2BCmds(),
  ])

  return { openMarkdownViewer, openMarkdownHref, openDroppedMarkdown }
}
