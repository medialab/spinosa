import { createResource, createMemo, createSignal, onMount, Show } from "solid-js"
import { writeFile, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { homedir, tmpdir } from "node:os"
import { spawn } from "node:child_process"
import { TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { MARKDOWN_VIEWER_HEIGHT_RATIO } from "../../ui/dialog"
import { useBindings } from "../../keymap"
import { useToast } from "../../ui/toast"
import { loadMarkdownFile, type MarkdownLoadResult } from "./load-markdown-file"

export function exportDownloadPath(filePath: string, workspaceRoot: string | undefined, ext: "md" | "pdf"): string {
  const rel = workspaceRoot ? path.relative(workspaceRoot, filePath) : filePath
  const display = rel.startsWith("..") ? filePath : rel
  const base = path.basename(display).replace(/\.[^.]*$/, "")
  return path.join(homedir(), "Downloads", `${base}.${ext}`)
}

export function DialogMdViewer(props: { filePath: string; workspaceRoot?: string }) {
  const dialog = useDialog()
  const toast = useToast()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const [exportState, setExportState] = createSignal<"idle" | "busy" | "done">("idle")
  const [pdfState, setPdfState] = createSignal<"idle" | "busy" | "done">("idle")

  const [editError, setEditError] = createSignal<string | undefined>()

  onMount(() => {
    dialog.setSize("xlarge")
    dialog.setHeightRatio(MARKDOWN_VIEWER_HEIGHT_RATIO)
  })

  const [loaded, { mutate: setLoaded }] = createResource(
    () => props.filePath,
    (filepath): Promise<MarkdownLoadResult> => loadMarkdownFile(filepath),
  )

  const mdText = createMemo(() => {
    const result = loaded()
    return result?.ok ? result.text : undefined
  })

  const loadError = createMemo(() => {
    const result = loaded()
    return result && !result.ok ? result.message : undefined
  })

  const displayPath = createMemo(() => {
    if (!props.workspaceRoot) return props.filePath
    const rel = path.relative(props.workspaceRoot, props.filePath)
    return rel.startsWith("..") ? props.filePath : rel
  })

  const exportPath = createMemo(() => exportDownloadPath(props.filePath, props.workspaceRoot, "md"))

  const pdfPath = createMemo(() => exportDownloadPath(props.filePath, props.workspaceRoot, "pdf"))

  const handleExport = async () => {
    if (exportState() !== "idle") return
    const md = mdText()
    if (!md) return
    setExportState("busy")
    try {
      await writeFile(exportPath(), md)
      setExportState("done")
      setTimeout(() => setExportState("idle"), 3000)
      toast.show({ variant: "success", message: `Saved to ~/Downloads/${path.basename(exportPath())}` })
    } catch (e) {
      setExportState("idle")
      toast.show({ variant: "error", message: `Export failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const handlePdfExport = async () => {
    if (pdfState() !== "idle") return
    const md = mdText()
    if (!md) return
    setPdfState("busy")
    try {
      const { exportMarkdownToPdf } = await import("@spinosa/core/export/markdown-pdf")
      const pdf = await exportMarkdownToPdf(md)
      await writeFile(pdfPath(), pdf)
      setPdfState("done")
      setTimeout(() => setPdfState("idle"), 3000)
      toast.show({ variant: "success", message: `Saved to ~/Downloads/${path.basename(pdfPath())}` })
    } catch (e) {
      setPdfState("idle")
      toast.show({ variant: "error", message: `PDF export failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const handleEdit = async () => {
    setEditError(undefined)
    const editor = process.env.VISUAL || process.env.EDITOR
    if (!editor) {
      setEditError("No $EDITOR or $VISUAL set")
      return
    }
    const md = mdText()
    if (loaded.loading) {
      setEditError("File is still loading, please wait")
      return
    }
    if (!md) {
      setEditError(loadError() ?? "File content unavailable")
      return
    }
    const tmpDir = await mkdtemp(path.join(tmpdir(), "spinosa-edit-"))
    const tmpFile = path.join(tmpDir, path.basename(props.filePath))
    try {
      await writeFile(tmpFile, md)
      renderer.suspend()
      renderer.currentRenderBuffer.clear()
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(editor, [tmpFile], {
            cwd: props.workspaceRoot ?? path.dirname(props.filePath),
            stdio: ["inherit", "inherit", "inherit"],
            shell: process.platform === "darwin" || process.platform === "win32",
          })
          child.on("error", reject)
          child.on("exit", (code, sig) => {
            if (code === 0) resolve()
            else reject(new Error(`Editor exited with ${sig ? `signal ${sig}` : `code ${code}`}`))
          })
        })
      } finally {
        renderer.currentRenderBuffer.clear()
        renderer.resume()
        renderer.requestRender()
      }
      const edited = await loadMarkdownFile(tmpFile)
      if (!edited.ok) {
        setEditError(edited.message)
        toast.show({ variant: "error", message: `Edit failed: ${edited.message}` })
        return
      }
      if (edited.text !== md) {
        await writeFile(props.filePath, edited.text)
        setLoaded({ ok: true, text: edited.text })
        toast.show({ variant: "success", message: "File saved" })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setEditError(msg)
      toast.show({ variant: "error", message: `Edit failed: ${msg}` })
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  const exportLabel = createMemo(() => {
    switch (exportState()) {
      case "busy": return "Exporting..."
      case "done": return "Exported!"
      default: return "[e] Export MD"
    }
  })

  const pdfLabel = createMemo(() => {
    switch (pdfState()) {
      case "busy": return "Exporting..."
      case "done": return "Exported!"
      default: return "[p] Export PDF"
    }
  })

  const exportColor = createMemo(() => {
    switch (exportState()) {
      case "busy": return theme.warning
      case "done": return theme.success
      default: return theme.primary
    }
  })

  const pdfColor = createMemo(() => {
    switch (pdfState()) {
      case "busy": return theme.warning
      case "done": return theme.success
      default: return theme.primary
    }
  })

  useBindings(() => ({
    bindings: [
      { key: "escape", cmd: () => dialog.clear() },
      { key: "return", cmd: () => dialog.clear() },
      { key: "e", cmd: () => void handleExport() },
      { key: "p", cmd: () => void handlePdfExport() },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1}
      gap={0} flexDirection="column" minHeight={0}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0} paddingBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {displayPath()}
        </text>
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted} attributes={TextAttributes.UNDERLINE}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              void handleEdit()
            }}>
            Edit
          </text>
          <text fg={theme.textMuted} onMouseUp={() => {
            if (renderer.getSelection()?.getSelectedText()) return
            dialog.clear()
          }}>
            esc
          </text>
        </box>
      </box>
      <box height={1} border={["top"]} borderColor={theme.border} flexShrink={0} />
      <scrollbox flexGrow={2} minHeight={0} paddingTop={1} paddingBottom={1}>
        <Show when={loaded.loading}>
          <text fg={theme.textMuted}>Loading...</text>
        </Show>
        <Show when={!loaded.loading && loadError()}>
          {(msg) => (
            <box paddingLeft={1} flexDirection="column" gap={1}>
              <text fg={theme.error}>{msg()}</text>
              <text fg={theme.textMuted}>
                The path was resolved, but the file is missing (deleted, never written, or a stale chat link). Press esc to close.
              </text>
            </box>
          )}
        </Show>
        <Show when={!loaded.loading && mdText() !== undefined}>
          <box paddingLeft={1}>
            <markdown
              content={mdText()!}
              syntaxStyle={syntax()}
              streaming={false}
              internalBlockMode="top-level"
              tableOptions={{ style: "grid" }}
              fg={theme.markdownText}
              bg={theme.background}
            />
          </box>
        </Show>
        <Show when={editError()}>
          {(msg) => (
            <box paddingLeft={1} paddingTop={1}>
              <text fg={theme.error}>{msg()}</text>
            </box>
          )}
        </Show>
      </scrollbox>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0} paddingTop={1} paddingBottom={1}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          esc return close · e md · p pdf
        </text>
        <box flexDirection="row" gap={2}>
          <box
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              void handleExport()
            }}
            paddingLeft={2} paddingRight={2}
            backgroundColor={exportColor()}
          >
            <text fg={theme.selectedListItemText}>{exportLabel()}</text>
          </box>
          <box
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              void handlePdfExport()
            }}
            paddingLeft={2} paddingRight={2}
            backgroundColor={pdfColor()}
          >
            <text fg={theme.selectedListItemText}>{pdfLabel()}</text>
          </box>
        </box>
      </box>
    </box>
  )
}
