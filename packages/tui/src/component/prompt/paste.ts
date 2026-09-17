import path from "node:path"
import { pastedFilepath } from "./helpers"
import { readLocalAttachment } from "./local-attachment"

export type PasteAttachment = {
  filename?: string
  filepath?: string
  content: string
  mime: string
}

export type PasteInput = {
  readonly isDestroyed: boolean
  insertText: (text: string) => void
  getLayoutNode: () => { markDirty: () => void }
}

export type PasteInputDependencies = {
  input: PasteInput
  platform: string
  summaryEnabled: () => boolean
  pasteText: (text: string, virtualText: string) => void
  pasteAttachment: (file: PasteAttachment) => Promise<void>
  requestRender: () => void
}

export async function pasteInputText(text: string, dependencies: PasteInputDependencies) {
  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const pastedContent = normalizedText.trim()
  const filepath = pastedFilepath(pastedContent, dependencies.platform)
  const isUrl = /^(https?):\/\//.test(filepath)

  if (!isUrl) {
    const attachment = await readLocalAttachment(filepath)
    const filename = path.basename(filepath)

    if (attachment?.type === "text") {
      dependencies.pasteText(attachment.content, `[SVG: ${filename ?? "image"}]`)
      return
    }

    if (attachment?.type === "binary") {
      await dependencies.pasteAttachment({
        filename,
        filepath,
        mime: attachment.mime,
        content: Buffer.from(attachment.content).toString("base64"),
      })
      return
    }
  }

  const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
  if ((lineCount >= 3 || pastedContent.length > 150) && dependencies.summaryEnabled()) {
    dependencies.pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
    return
  }

  dependencies.input.insertText(normalizedText)

  setTimeout(() => {
    if (dependencies.input.isDestroyed) return
    dependencies.input.getLayoutNode().markDirty()
    dependencies.requestRender()
  }, 0)
}
