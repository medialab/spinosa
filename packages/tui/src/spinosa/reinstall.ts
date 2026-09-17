import { existsSync } from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { resolveFrameworkRoot } from "@spinosa/core/framework/discovery"
import { readBundledFrameworkVersion } from "./service"
import { tuiLog } from "./log"
import type { CliRunResult } from "./types"

const REINSTALL_TIMEOUT_MS = 900_000

export type ReinstallInput = {
  channel?: string
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

/** Strip terminal control output before it is appended to a TUI log. */
export function cleanReinstallOutput(value: string): string {
  return value
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
}

/** Reinstall the bundled vendor tools through the framework installer. */
export async function runReinstall(
  input?: ReinstallInput,
): Promise<CliRunResult> {
  tuiLog("runReinstall (bash)")

  const fwRoot = resolveFrameworkRoot()
  if (!fwRoot) {
    const msg = "Framework root not found — cannot reinstall vendor tools."
    input?.onStderr?.(msg + "\n")
    return { exitCode: 1, stdout: "", stderr: msg }
  }

  const localInstaller = path.join(fwRoot, "install.sh")
  if (!existsSync(localInstaller)) {
    const msg = "install.sh not found in framework root."
    input?.onStderr?.(msg + "\n")
    return { exitCode: 1, stdout: "", stderr: msg }
  }

  const version = await readBundledFrameworkVersion()
  if (!version) {
    const msg = "Could not read bundled framework version."
    input?.onStderr?.(msg + "\n")
    return { exitCode: 1, stdout: "", stderr: msg }
  }

  input?.onStdout?.(`Reinstalling vendor tools for v${version}...\n`)

  return new Promise<CliRunResult>((resolve) => {
    let timedOut = false
    let stdout = ""
    let stderr = ""
    let settled = false

    const finish = (result: CliRunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const child = spawn(
      "bash",
      [
        localInstaller,
        "--reinstall",
        "--version",
        version,
        "--yes",
        "--no-launch",
        "--no-bundled-tools",
      ],
      { stdio: ["ignore", "pipe", "pipe"], detached: true },
    )

    const killTree = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) {
          try {
            process.kill(-child.pid, signal)
          } catch {
            child.kill(signal)
          }
        } else {
          child.kill(signal)
        }
      } catch {}
    }

    const timer = setTimeout(() => {
      timedOut = true
      const msg = `Reinstall timed out after ${REINSTALL_TIMEOUT_MS / 1000}s.`
      stderr += `\n${msg}\n`
      input?.onStderr?.(`${msg}\n`)
      tuiLog(`reinstall timeout after ${REINSTALL_TIMEOUT_MS}ms`)
      killTree("SIGTERM")
      const grace = setTimeout(() => {
        if (!settled) {
          killTree("SIGKILL")
        }
      }, 3000)
      if (typeof (grace as unknown as { unref?: () => void }).unref === "function") {
        ;(grace as unknown as { unref: () => void }).unref!()
      }
      // Do not resolve immediately — wait for close/error to ensure tree reaped
    }, REINSTALL_TIMEOUT_MS)
    if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
      ;(timer as unknown as { unref: () => void }).unref!()
    }

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8")
      stdout += text
      const clean = cleanReinstallOutput(text)
      if (clean) input?.onStdout?.(clean + "\n")
    })
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8")
      stderr += text
      const clean = cleanReinstallOutput(text)
      if (clean) input?.onStderr?.(clean + "\n")
    })

    const done = (code: number | null) => {
      if (settled) return
      clearTimeout(timer)
      if (timedOut) {
        finish({ exitCode: 124, stdout, stderr })
        return
      }
      if (code === 0) {
        input?.onStdout?.("Reinstall complete.\n")
        finish({ exitCode: 0, stdout, stderr })
      } else {
        const errMsg = code !== null ? `Reinstall failed with exit ${code}` : "Reinstall failed"
        if (stderr.trim().length === 0) {
          input?.onStderr?.(`${errMsg}\n`)
        }
        finish({ exitCode: code ?? 1, stdout, stderr: stderr || errMsg })
      }
    }
    child.on("close", (code) => done(code))
    child.on("error", (err) => {
      finish({ exitCode: 1, stdout, stderr: stderr || err.message })
    })
  })
}
