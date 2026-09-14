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
