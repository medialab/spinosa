/**
 * Single-document PDF processing: open once, walk pages in order.
 * Embedded text pages return {kind:"text"}; imageless pages return
 * {kind:"image", image} with an in-memory PNG buffer for Vision transcription.
 */
import { withPdfDocument } from "../extension/pdf-js"
import { extractPageText, isUsableText, type ClassifiedPdfPage } from "./text"
import { renderPage, type RenderOptions } from "./render"

export type PdfPageOutcome =
  | { page: number; kind: "text"; text: string }
  | { page: number; kind: "image"; image: Buffer }
  | { page: number; kind: "failed"; error: string }

export async function processPdf(
  file: string,
  options?: { render?: RenderOptions; shouldAbort?: () => boolean; signal?: AbortSignal },
): Promise<PdfPageOutcome[]> {
  return withPdfDocument(file, async (doc) => {
    const out: PdfPageOutcome[] = []
    for (let page = 1; page <= doc.numPages; page++) {
      if (options?.shouldAbort?.() || options?.signal?.aborted) {
        out.push({ page, kind: "failed", error: "cancelled" })
        continue
      }
      let text: string
      try {
        text = await extractPageText(doc, page)
      } catch (err) {
        out.push({ page, kind: "failed", error: err instanceof Error ? err.message : String(err) })
        continue
      }
      if (isUsableText(text)) {
        out.push({ page, kind: "text", text })
        continue
      }
      try {
        const image = await renderPage(doc, page, options?.render)
        out.push({ page, kind: "image", image })
      } catch (err) {
        out.push({ page, kind: "failed", error: err instanceof Error ? err.message : String(err) })
      }
    }
    return out
  })
}

export type { ClassifiedPdfPage }
