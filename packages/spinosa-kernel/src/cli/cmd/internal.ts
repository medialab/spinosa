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
          // ppu-paddle-ocr purged — tesseract is sole OCR engine; ocr-worker is deprecated
          process.stdout.write(
            `${JSON.stringify({ type: "error", message: "ocr-worker deprecated: ppu-paddle-ocr removed, use tesseract" })}\n`,
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
