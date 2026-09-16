import type { Argv } from "yargs"
import {
  ensureEmbeddedTemplateCache,
  verifyEmbeddedTemplateCache,
  isCompiledBinaryDistribution,
  compiledVersion,
  compiledTemplatePackId,
} from "@spinosa/core/distribution/bootstrap"
import { getFormat, emitResult } from "../output"
import { decodeWorkerPayload } from "@spinosa/core/import/worker-payload"

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

export interface NativeImportCheck {
  name: string
  ok: boolean
  error?: string
}

/**
 * Pure aggregation for `internal smoke native-imports`. Every check must
 * pass — a single corrupt native (beta.18/beta.19 Mach-O outage) fails the
 * gate. Extracted so unit tests pin the fail-closed semantics.
 */
export function evaluateNativeImportChecks(checks: NativeImportCheck[]): {
  ok: boolean
  payload: { ok: boolean; checks: NativeImportCheck[] }
} {
  const ok = checks.length > 0 && checks.every((c) => c.ok)
  return { ok, payload: { ok, checks } }
}

/**
 * Minimal one-page PDF for `internal smoke pdf-runtime` (inline bytes — the
 * smoke must be self-contained inside the compiled binary, no fixtures).
 * Stream Length 43 = 42 content bytes + trailing newline; pdf.js recovers
 * the missing xref table on its own.
 */
const TINY_SMOKE_PDF = Buffer.from(
  [
    "%PDF-1.4",
    "1 0 obj",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "endobj",
    "2 0 obj",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "endobj",
    "3 0 obj",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "endobj",
    "4 0 obj",
    "<< /Length 43 >>",
    "stream",
    "BT /F1 12 Tf 50 150 Td (Hello smoke) Tj ET",
    "endstream",
    "endobj",
    "5 0 obj",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "endobj",
    "trailer",
    "<< /Root 1 0 R >>",
    "%%EOF",
    "",
  ].join("\n"),
  "utf-8",
)

export const InternalCommand = {
  command: "internal",
  describe: false as const,
  builder: (yargs: Argv) =>
    yargs
      .command("template", "Template pack helpers", (inner) =>
        inner
          .command(
            "ensure",
            "Ensure the embedded template cache exists",
            (y) =>
              y
                .option("force", {
                  type: "boolean",
                  default: false,
                  describe: "Rebuild cache even if complete",
                })
                .option("json", { type: "boolean", default: false }),
            async (args) => {
              const result = ensureEmbeddedTemplateCache({ force: Boolean(args.force) })
              const payload = {
                ok: result.ok,
                version: result.version,
                templatePackId: result.templatePackId,
                templateRoot: result.templateRoot,
                repaired: result.repaired ?? false,
                error: result.error,
                distribution: isCompiledBinaryDistribution() ? "binary" : "dev",
              }
              if (args.json || getFormat(args) === "json") printJson(payload)
              else emitResult("human", "template-ensure", payload, result.ok ? "ok" : result.error ?? "failed")
              if (!result.ok) process.exitCode = 1
            },
          )
          .command(
            "verify",
            "Verify the embedded template cache",
            (y) => y.option("json", { type: "boolean", default: false }),
            async (args) => {
              const result = verifyEmbeddedTemplateCache()
              const payload = {
                ok: result.ok,
                version: result.version || compiledVersion(),
                templatePackId: result.templatePackId || compiledTemplatePackId(),
                templateRoot: result.templateRoot,
                error: result.error,
                distribution: isCompiledBinaryDistribution() ? "binary" : "dev",
              }
              if (args.json || getFormat(args) === "json") printJson(payload)
              else emitResult("human", "template-verify", payload, result.ok ? "ok" : result.error ?? "failed")
              if (!result.ok) process.exitCode = 1
            },
          )
          .demandCommand(1),
      )
      .command("smoke", "Native smoke helpers (release gates)", (inner) =>
        inner
          .command(
            "native-imports",
            "Load OpenTUI, FFF, watcher, node-pty, and canvas without starting a UI",
            (y) => y.option("json", { type: "boolean", default: false }),
            async (args) => {
              const checks: NativeImportCheck[] = []
              // Static specifiers so Bun --compile embeds the modules
              // (variable import() cannot be traced). Each check only loads
              // the native binding — never starts an interactive UI.
              // A corrupt embedded Mach-O dies here (SIGKILL/dlopen failure),
              // which is exactly what version/doctor smoke misses.
              try {
                const mod = await import("@opentui/core")
                if (!mod || (typeof mod !== "object" && typeof mod !== "function")) {
                  throw new Error("empty @opentui/core namespace")
                }
                checks.push({ name: "opentui", ok: true })
              } catch (err) {
                checks.push({ name: "opentui", ok: false, error: err instanceof Error ? err.message : String(err) })
              }
              try {
                const mod = (await import("@ff-labs/fff-bun")) as {
                  FileFinder?: { isAvailable?: () => boolean }
                }
                const available = mod?.FileFinder?.isAvailable?.() ?? false
                if (!available) throw new Error("FileFinder.isAvailable() returned false")
                checks.push({ name: "fff", ok: true })
              } catch (err) {
                checks.push({ name: "fff", ok: false, error: err instanceof Error ? err.message : String(err) })
              }
              try {
                const mod = (await import("@spinosa/kernel-core/filesystem/watcher")) as {
                  hasNativeBinding?: () => boolean
                }
                if (typeof mod?.hasNativeBinding !== "function") {
                  throw new Error("watcher hasNativeBinding missing")
                }
                if (!mod.hasNativeBinding()) throw new Error("watcher native binding unavailable")
                checks.push({ name: "watcher", ok: true })
              } catch (err) {
                checks.push({ name: "watcher", ok: false, error: err instanceof Error ? err.message : String(err) })
              }
              try {
                const mod = (await import("@spinosa/kernel-core/pty/pty.bun")) as { spawn?: unknown }
                if (typeof mod?.spawn !== "function") throw new Error("pty spawn missing")
                checks.push({ name: "node-pty", ok: true })
              } catch (err) {
                checks.push({ name: "node-pty", ok: false, error: err instanceof Error ? err.message : String(err) })
              }
              try {
                const mod = await import("@napi-rs/canvas")
                if (!mod) throw new Error("empty @napi-rs/canvas namespace")
                checks.push({ name: "canvas", ok: true })
              } catch (err) {
                checks.push({ name: "canvas", ok: false, error: err instanceof Error ? err.message : String(err) })
              }
              const { ok, payload } = evaluateNativeImportChecks(checks)
              if (args.json || getFormat(args) === "json") printJson(payload)
              else {
                for (const c of checks) {
                  emitResult("human", `native-${c.name}`, { ok: c.ok }, c.ok ? "ok" : (c.error ?? "failed"))
                }
              }
              if (!ok) process.exitCode = 1
            },
          )
          .command(
            "provider-catalog",
            "Prove the embedded models.dev snapshot converts to a non-empty /provider catalog with selectable defaults",
            (y) => y.option("json", { type: "boolean", default: false }),
            async (args) => {
              // Release gate for the empty connect-dialog outage: version and
              // native-imports smoke never touch the provider catalog, so a
              // binary with a missing snapshot or an unconvertible entry
              // shipped green. This runs the exact /provider list transform
              // (snapshot + pure conversion, no network, no server, no
              // credentials) and fails closed on an empty catalog.
              // A catalog with providers but zero selectable defaults is
              // equally unusable (nothing to select in the dialog), so it
              // fails too — see defaultModelIDs skipping zero-model entries.
              const fail = (message: string) => {
                if (args.json || getFormat(args) === "json") printJson({ ok: false, error: message })
                else emitResult("human", "provider-catalog", { ok: false }, message)
                process.exitCode = 1
              }
              try {
                // Static specifiers so Bun --compile embeds the modules
                // (variable import() cannot be traced).
                const { embeddedModelsSnapshot } = await import("@spinosa/kernel-core/models-dev")
                const { evaluateProviderCatalogSmoke } = await import("@/provider/provider")
                const result = evaluateProviderCatalogSmoke(embeddedModelsSnapshot())
                if (!result.ok) {
                  fail(result.error)
                  return
                }
                if (args.json || getFormat(args) === "json") {
                  printJson({ ok: true, providers: result.providers, skipped: result.skipped, defaults: result.defaults })
                } else {
                  emitResult("human", "provider-catalog", { ok: true, providers: result.providers }, `ok (${result.providers} providers)`)
                  if (result.skipped.length > 0) {
                    emitResult(
                      "human",
                      "provider-catalog-skipped",
                      { skipped: result.skipped },
                      `skipped malformed entries: ${result.skipped.join(", ")}`,
                    )
                  }
                }
              } catch (err) {
                fail(err instanceof Error ? err.message : String(err))
              }
            },
          )
          .command(
            "pdf-runtime",
            "Prove the PDF engine renders: import PDF.js, install canvas globals, raster one tiny page",
            (y) => y.option("json", { type: "boolean", default: false }),
            async (args) => {
              // Release gate for the "bundled but broken" PDF path: doctor
              // and native-imports only prove the modules resolve, not that a
              // page renders through the staged canvas native. Renders one
              // tiny page at 72 DPI and fails closed on any error or on
              // output without a PNG signature.
              const fail = (message: string) => {
                if (args.json || getFormat(args) === "json") printJson({ ok: false, error: message })
                else emitResult("human", "pdf-runtime", { ok: false }, message)
                process.exitCode = 1
              }
              try {
                // Static specifiers so Bun --compile embeds the modules
                // (variable import() cannot be traced).
                const { withPdfDocument } = await import("@spinosa/core/extension/pdf-js")
                const { renderPage } = await import("@spinosa/core/pdf/render")
                const os = await import("node:os")
                const path = await import("node:path")
                const fs = await import("node:fs/promises")
                const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spinosa-pdf-smoke-"))
                const pdfPath = path.join(dir, "tiny.pdf")
                try {
                  await fs.writeFile(pdfPath, TINY_SMOKE_PDF)
                  const png = await withPdfDocument(pdfPath, (doc) => renderPage(doc, 1, { dpi: 72 }))
                  if (
                    png.length < 100 ||
                    png[0] !== 0x89 ||
                    png[1] !== 0x50 ||
                    png[2] !== 0x4e ||
                    png[3] !== 0x47
                  ) {
                    fail(`pdf render produced ${png.length} bytes without a PNG signature`)
                    return
                  }
                  const g = globalThis as Record<string, unknown>
                  const globals = {
                    ImageData: typeof g.ImageData,
                    Path2D: typeof g.Path2D,
                    DOMMatrix: typeof g.DOMMatrix,
                  }
                  if (args.json || getFormat(args) === "json") {
                    printJson({ ok: true, pngBytes: png.length, globals })
                  } else {
                    emitResult(
                      "human",
                      "pdf-runtime",
                      { ok: true, pngBytes: png.length },
                      `ok (${png.length} png bytes)`,
                    )
                  }
                } finally {
                  await fs.rm(dir, { recursive: true, force: true })
                }
              } catch (err) {
                fail(err instanceof Error ? err.message : String(err))
              }
            },
          )
          .demandCommand(1),
      )
      .command({
        command: "ocr-worker [payload]",
        describe: false,
        builder: (y: Argv) =>
          y.positional("payload", {
            type: "string",
            describe: "JSON payload { files: [{ src, rel, dest }] }",
          }),
        handler: async (args: { payload?: string }) => {
          // Machine protocol on stdout (NDJSON). Do not mix human UI.
          const raw = typeof args.payload === "string" ? args.payload : ""
          if (!raw) {
            process.stdout.write(`${JSON.stringify({ type: "error", message: "missing ocr-worker payload" })}\n`)
            process.exit(1)
          }
          let input: { files?: unknown }
          try {
            input = decodeWorkerPayload(raw) as { files?: unknown }
          } catch (err) {
            process.stdout.write(
              `${JSON.stringify({
                type: "error",
                message: `invalid ocr-worker JSON: ${err instanceof Error ? err.message : String(err)}`,
              })}\n`,
            )
            process.exit(1)
          }
          if (!Array.isArray(input.files)) {
            process.stdout.write(
              `${JSON.stringify({ type: "error", message: "ocr-worker payload.files must be an array" })}\n`,
            )
            process.exit(1)
          }
          const { ocrUnsupportedReason } = await import("@spinosa/core/tools/ocr-support")
          const unsupported = ocrUnsupportedReason()
          if (unsupported) {
            process.stdout.write(`${JSON.stringify({ type: "error", message: unsupported })}\n`)
            process.exit(1)
          }
          // ocr-worker is removed — no local OCR engine ships. Scans
          // transcribe via a vision model, or copy as-is (pdf.js for digital PDFs).
          process.stdout.write(
            `${JSON.stringify({ type: "error", message: "ocr-worker removed: local OCR was removed — pick a vision model to transcribe scans, or copy files as-is" })}\n`,
          )
          process.exit(1)
        },
      })
      .command({
        command: "markitdown-worker [payload]",
        describe: false,
        builder: (y: Argv) =>
          y.positional("payload", {
            type: "string",
            describe: "JSON payload { files: [{ src, rel, dest }], logsDir }",
          }),
        handler: async (args: { payload?: string }) => {
          const raw = typeof args.payload === "string" ? args.payload : ""
          if (!raw) {
            process.stdout.write(
              `${JSON.stringify({ type: "error", message: "missing markitdown-worker payload" })}\n`,
            )
            process.exit(1)
          }
          let input: { files?: unknown; logsDir?: unknown }
          try {
            input = decodeWorkerPayload(raw) as { files?: unknown; logsDir?: unknown }
          } catch (err) {
            process.stdout.write(
              `${JSON.stringify({
                type: "error",
                message: `invalid markitdown-worker JSON: ${err instanceof Error ? err.message : String(err)}`,
              })}\n`,
            )
            process.exit(1)
          }
          if (!Array.isArray(input.files) || typeof input.logsDir !== "string") {
            process.stdout.write(
              `${JSON.stringify({
                type: "error",
                message: "markitdown-worker payload must include files[] and logsDir",
              })}\n`,
            )
            process.exit(1)
          }
          const { runMarkitdownWorkerMain } = await import("@spinosa/core/import/markitdown-worker")
          try {
            await runMarkitdownWorkerMain({
              files: input.files as never,
              logsDir: input.logsDir,
            })
            process.exit(0)
          } catch (err) {
            process.stdout.write(
              `${JSON.stringify({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
              })}\n`,
            )
            process.exit(1)
          }
        },
      })
      .demandCommand(1),
  handler: () => undefined,
}
