import { createResource, createMemo, createSignal, onMount, Show } from "solid-js"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import { RGBA, TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import { useKV } from "../../context/kv"
import { useDialog } from "../../ui/dialog"
import { MARKDOWN_VIEWER_HEIGHT_RATIO } from "../../ui/dialog"
import { useBindings } from "../../keymap"
import { useToast } from "../../ui/toast"
import { useWait } from "../../context/wait"
import { HoverChip, HoverLabel } from "../../ui/hover-press"
import { loadMarkdownFile, type MarkdownLoadResult } from "./load-markdown-file"
import { WaveSpinner } from "../../component/wave-spinner"
import {
  clampMdViewerScale,
  MD_VIEWER_SCALE_DEFAULT,
  mdViewerSidePad,
  mdViewerTableCellPad,
} from "./md-viewer-scale"

/** Dark blue for MD export — darker than theme.primary on the dark palette. */
export const MD_EXPORT_BLUE = RGBA.fromHex("#3b7dd8")

export function exportDownloadPath(filePath: string, workspaceRoot: string | undefined, ext: "md" | "pdf"): string {
  const rel = workspaceRoot ? path.relative(workspaceRoot, filePath) : filePath
  const display = rel.startsWith("..") ? filePath : rel
  const base = path.basename(display).replace(/\.[^.]*$/, "")
  return path.join(homedir(), "Downloads", `${base}.${ext}`)
}

export function DialogMdViewer(props: { filePath: string; workspaceRoot?: string }) {
  const dialog = useDialog()
  const toast = useToast()
  const wait = useWait()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const [storedScale, setStoredScale] = kv.signal<number>("markdown_viewer_scale", MD_VIEWER_SCALE_DEFAULT)
  const scale = () => clampMdViewerScale(storedScale())
  const bumpScale = (delta: number) => {
    setStoredScale((prev) => clampMdViewerScale((typeof prev === "number" ? prev : MD_VIEWER_SCALE_DEFAULT) + delta))
  }
  const [exportState, setExportState] = createSignal<"idle" | "busy" | "done">("idle")
  const [pdfState, setPdfState] = createSignal<"idle" | "busy" | "done">("idle")

  onMount(() => {
    dialog.setSize("xlarge")
    dialog.setHeightRatio(MARKDOWN_VIEWER_HEIGHT_RATIO)
  })

  const [loaded] = createResource(
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

  const mdAccent = () => {
    if (exportState() === "busy") return theme.warning
    if (exportState() === "done") return theme.success
    return MD_EXPORT_BLUE
  }

  const pdfAccent = () => {
    if (pdfState() === "busy") return theme.warning
    if (pdfState() === "done") return theme.success
    return theme.warning
  }

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
      const pdf = await wait.withWait("Exporting PDF…", () => exportMarkdownToPdf(md))
      await writeFile(pdfPath(), pdf)
      setPdfState("done")
      setTimeout(() => setPdfState("idle"), 3000)
      toast.show({ variant: "success", message: `Saved to ~/Downloads/${path.basename(pdfPath())}` })
    } catch (e) {
      setPdfState("idle")
      toast.show({ variant: "error", message: `PDF export failed: ${e instanceof Error ? e.message : String(e)}` })
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

  useBindings(() => ({
    bindings: [
      { key: "escape", cmd: () => dialog.clear() },
      { key: "return", cmd: () => dialog.clear() },
      { key: "e", cmd: () => void handleExport() },
      { key: "p", cmd: () => void handlePdfExport() },
      { key: "-", cmd: () => bumpScale(-1) },
      { key: "+", cmd: () => bumpScale(1) },
      { key: "=", cmd: () => bumpScale(1) },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1}
      gap={0} flexDirection="column" minHeight={0}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0} paddingBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {displayPath()}
        </text>
        <box flexDirection="row" gap={1}>
          <HoverChip flexShrink={0} label="-" onPress={() => bumpScale(-1)} />
          <text fg={theme.textMuted}>{`Aa ${scale()}`}</text>
          <HoverChip flexShrink={0} label="+" onPress={() => bumpScale(1)} />
          <HoverLabel
            onPress={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              dialog.clear()
            }}
          >
            esc
          </HoverLabel>
        </box>
      </box>
      <box height={1} border={["top"]} borderColor={theme.border} flexShrink={0} />
      <scrollbox flexGrow={2} minHeight={0} paddingTop={1} paddingBottom={1}>
        <Show when={loaded.loading}>
          <WaveSpinner color={theme.primary}>Loading…</WaveSpinner>
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
          <box paddingLeft={1 + mdViewerSidePad(scale())} paddingRight={mdViewerSidePad(scale())}>
            <markdown
              content={mdText()!}
              syntaxStyle={syntax()}
              streaming={false}
              internalBlockMode="top-level"
              tableOptions={{ style: "grid", cellPaddingY: mdViewerTableCellPad(scale()) }}
              fg={theme.markdownText}
              bg={theme.background}
            />
          </box>
        </Show>
      </scrollbox>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0} paddingTop={1} paddingBottom={1}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          esc close · - + size · e md · p pdf
        </text>
        <box flexDirection="row" gap={2}>
          <HoverChip
            flexShrink={0}
            label={exportLabel()}
            accent={mdAccent()}
            active={exportState() !== "idle"}
            paddingLeft={2}
            paddingRight={2}
            onPress={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              void handleExport()
            }}
          />
          <HoverChip
            flexShrink={0}
            label={pdfLabel()}
            accent={pdfAccent()}
            active={pdfState() !== "idle"}
            paddingLeft={2}
            paddingRight={2}
            onPress={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              void handlePdfExport()
            }}
          />
        </box>
      </box>
    </box>
  )
}
