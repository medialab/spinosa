import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { parseSpinosaCliArgs, runSpinosaCli, splitSpinosaCliCommand } from "../../src/spinosa-cli"
import { readFileSync } from "node:fs"
import { chmod, mkdir, utimes } from "node:fs/promises"
import { runUninstall } from "../../src/spinosa-cli/commands/uninstall"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const EXPECTED_VERSION = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8")).version as string

function capture() {
  const output: string[] = []
  const errors: string[] = []
  return {
    output,
    errors,
    io: {
      out: (message: string) => { output.push(message) },
      error: (message: string) => { errors.push(message) },
      format: "human" as const,
      confirm: async () => false,
    },
  }
}

async function installSourceKernel(home: string): Promise<void> {
  const target = path.join(home, "bin", "spinosa")
  const kernelEntry = path.join(repoRoot, "packages/spinosa-kernel/src/index.ts")
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, `#!/bin/sh\nexec ${quote(process.execPath)} run ${quote(kernelEntry)} "$@"\n`)
  await chmod(target, 0o755)
}

describe("Spinosa CLI", () => {
  test("parses option order and explicit upgrade values", () => {
    const parsed = parseSpinosaCliArgs(["--yes", "--version", "1.2.3", "--channel=beta"])
    expect(parsed.flags.has("yes")).toBe(true)
    expect(parsed.values.get("version")).toBe("1.2.3")
    expect(parsed.values.get("channel")).toBe("beta")
  })

  test("accepts global output flags before the command", () => {
    expect(splitSpinosaCliCommand(["--json", "--no-color", "status", "/workspace"])).toEqual({
      command: "status",
      rest: ["--json", "--no-color", "/workspace"],
    })
  })

  test("prints repository version", async () => {
    const originalRoot = process.env.SPINOSA_TEMPLATE_ROOT
    process.env.SPINOSA_TEMPLATE_ROOT = repoRoot
    const result = capture()
    try {
      expect(await runSpinosaCli(["version"], result.io)).toBe(0)
      expect(result.output).toEqual([`spinosa ${EXPECTED_VERSION}`])
    } finally {
      if (originalRoot === undefined) delete process.env.SPINOSA_TEMPLATE_ROOT
      else process.env.SPINOSA_TEMPLATE_ROOT = originalRoot
    }
  })

  test("returns nonzero for missing create source", async () => {
    const result = capture()
    expect(await runSpinosaCli(["create", "/definitely/missing"], result.io)).toBe(1)
    expect(result.errors[0]).toContain("does not exist")
  })

  test("rejects unknown options", async () => {
    const unknown = capture()
    expect(await runSpinosaCli(["doctor", "--bogus"], unknown.io)).toBe(1)
    expect(unknown.errors[0]).toContain("Unknown option")
  })

  test("launcher dispatches upgrade help through the kernel CLI", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    await installSourceKernel(home)
    const spawned = Bun.spawnSync({
      cmd: ["bash", path.join(repoRoot, "workspace-template", ".bin", "spinosa"), "upgrade", "--help"],
      cwd: repoRoot,
      env: { ...process.env, SPINOSA_HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(spawned.exitCode).toBe(0)
    expect(spawned.stderr.toString()).toContain("upgrade")
  })

  test("launcher dispatches version instead of treating it as a project path", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    await installSourceKernel(home)
    const spawned = Bun.spawnSync({
      cmd: ["bash", path.join(repoRoot, "workspace-template", ".bin", "spinosa"), "version"],
      cwd: repoRoot,
      env: { ...process.env, SPINOSA_HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(spawned.exitCode).toBe(0)
    expect(spawned.stdout.toString()).toContain(`spinosa ${EXPECTED_VERSION}`)
    expect(spawned.stderr.toString()).not.toContain("Failed to change directory")
  })

  test("uninstall help never removes files", async () => {
    await using tmp = await tmpdir()
    const sentinel = path.join(tmp.path, "keep.txt")
    await Bun.write(sentinel, "keep\n")
    await installSourceKernel(tmp.path)
    const spawned = Bun.spawnSync({
      cmd: ["bash", path.join(repoRoot, "workspace-template", ".bin", "spinosa"), "uninstall", "--help"],
      cwd: repoRoot,
      env: { ...process.env, SPINOSA_HOME: tmp.path },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(spawned.exitCode).toBe(0)
    expect(spawned.stderr.toString()).toContain("uninstall")
    expect(await Bun.file(sentinel).text()).toBe("keep\n")
  })

  test("uninstall rejects unsafe spinosa home", async () => {
    await using tmp = await tmpdir()
    const sentinel = path.join(tmp.path, "keep.txt")
    await Bun.write(sentinel, "keep\n")
    const result = capture()
    process.env.SPINOSA_HOME = tmp.path
    try {
      expect(await runUninstall(result.io, true)).toBe(1)
      expect(await Bun.file(sentinel).text()).toBe("keep\n")
      expect(result.errors[0]).toContain("does not look like a Spinosa installation")
    } finally {
      delete process.env.SPINOSA_HOME
    }
  })

  test("interactive uninstall accepts input and preserves central metadata and legacy versions", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.SPINOSA_HOME
    const metadata = path.join(tmp.path, "metadata")
    await mkdir(metadata, { recursive: true })
    await mkdir(path.join(tmp.path, "versions", "broken"), { recursive: true })
    await mkdir(path.join(tmp.path, "bin"), { recursive: true })
    await Bun.write(path.join(metadata, "workspaces.json"), '{"schemaVersion":1,"workspaces":[]}\n')
    await Bun.write(path.join(metadata, "config.yaml"), "spinosa: true\n")
    process.env.SPINOSA_HOME = tmp.path
    try {
      const result = capture()
      expect(await runUninstall(result.io, false, async () => true)).toBe(0)
      expect(existsSync(path.join(tmp.path, "versions", "broken"))).toBe(true)
      expect(existsSync(path.join(tmp.path, "bin", "spinosa"))).toBe(false)
      expect(await Bun.file(path.join(metadata, "workspaces.json")).text()).toBe('{"schemaVersion":1,"workspaces":[]}\n')
    } finally {
      if (originalHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = originalHome
    }
  })

  test("interactive uninstall reports terminal failures without deleting runtime files", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.SPINOSA_HOME
    await mkdir(path.join(tmp.path, "metadata"), { recursive: true })
    await mkdir(path.join(tmp.path, "versions", "keep"), { recursive: true })
    await Bun.write(path.join(tmp.path, "metadata", "config.yaml"), "spinosa: true\n")
    process.env.SPINOSA_HOME = tmp.path
    try {
      const result = capture()
      expect(await runUninstall(result.io, false, async () => {
        throw new Error("Cannot read from the terminal. Re-run with --yes to skip prompts.")
      })).toBe(1)
      expect(result.errors[0]).toContain("--yes")
      expect(existsSync(path.join(tmp.path, "versions", "keep"))).toBe(true)
    } finally {
      if (originalHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = originalHome
    }
  })

  test("status reports framework info", async () => {
    const originalRoot = process.env.SPINOSA_TEMPLATE_ROOT
    process.env.SPINOSA_TEMPLATE_ROOT = repoRoot
    const result = capture()
    try {
      const code = await runSpinosaCli(["status"], result.io)
      expect(code).toBe(0)
      expect(result.output[0]).toContain("Spinosa")
    } finally {
      if (originalRoot === undefined) delete process.env.SPINOSA_TEMPLATE_ROOT
      else process.env.SPINOSA_TEMPLATE_ROOT = originalRoot
    }
  })

  test("status honors a positional workspace path", async () => {
    const workspace = path.join(repoRoot, "packages/tui/test/spinosa/fixtures/workspace-started")
    const result = capture()
    expect(await runSpinosaCli(["status", workspace], result.io)).toBe(1)
    expect(result.output).toContain(`  Workspace: ${workspace}`)
  })

  test("status rejects an explicitly invalid workspace path", async () => {
    const result = capture()
    expect(await runSpinosaCli(["status", "/definitely/missing"], result.io)).toBe(1)
    expect(result.output).toContain("  Workspace: invalid (/definitely/missing)")
  })

  test("list shows workspaces", async () => {
    const result = capture()
    expect(await runSpinosaCli(["list"], result.io)).toBe(0)
    expect(result.output.length).toBeGreaterThan(0)
  })

  test("help text lists all commands", async () => {
    const result = capture()
    expect(await runSpinosaCli(["help"], result.io)).toBe(0)
    const text = result.output.join("\n")
    expect(text).toContain("spinosa status")
    expect(text).toContain("spinosa list")
    expect(text).toContain("spinosa uninstall")
    expect(text).toContain("spinosa startup-autoclean")
    expect(text).toContain("--json")
    expect(text).toContain("--quiet")
  })

  test("startup-autoclean removes only abandoned installer directories", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.SPINOSA_HOME
    const versions = path.join(tmp.path, "versions")
    const stale = path.join(versions, ".0.9.0.staging.123")
    const release = path.join(versions, "0.9.0")
    await mkdir(path.join(stale, "node_modules"), { recursive: true })
    await mkdir(path.join(release, "node_modules"), { recursive: true })
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await utimes(stale, old, old)
    process.env.SPINOSA_HOME = tmp.path
    try {
      const result = capture()
      expect(await runSpinosaCli(["startup-autoclean"], result.io)).toBe(0)
      expect(existsSync(stale)).toBe(false)
      expect(existsSync(release)).toBe(true)
      expect(result.output.join("\n")).toContain("Removed stale installer/temp data")
    } finally {
      if (originalHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = originalHome
    }
  })

  test("startup-autoclean does not modify files while a staging install lock exists", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.SPINOSA_HOME
    const versions = path.join(tmp.path, "versions")
    const stale = path.join(versions, ".0.9.0.backup.123")
    await mkdir(stale, { recursive: true })
    await mkdir(path.join(tmp.path, ".staging", ".install.lock"), { recursive: true })
    process.env.SPINOSA_HOME = tmp.path
    try {
      const result = capture()
      expect(await runSpinosaCli(["startup-autoclean"], result.io)).toBe(1)
      expect(existsSync(stale)).toBe(true)
      expect(result.errors[0]).toContain("install is in progress")
    } finally {
      if (originalHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = originalHome
    }
  })

  test("startup-autoclean does not modify files while a legacy versions install lock exists", async () => {
    await using tmp = await tmpdir()
    const originalHome = process.env.SPINOSA_HOME
    const versions = path.join(tmp.path, "versions")
    const stale = path.join(versions, ".0.9.0.backup.123")
    await mkdir(stale, { recursive: true })
    await mkdir(path.join(versions, ".install.lock"), { recursive: true })
    process.env.SPINOSA_HOME = tmp.path
    try {
      const result = capture()
      expect(await runSpinosaCli(["startup-autoclean"], result.io)).toBe(1)
      expect(existsSync(stale)).toBe(true)
      expect(result.errors[0]).toContain("install is in progress")
    } finally {
      if (originalHome === undefined) delete process.env.SPINOSA_HOME
      else process.env.SPINOSA_HOME = originalHome
    }
  })

  test("version-only mode via env", async () => {
    const originalRoot = process.env.SPINOSA_TEMPLATE_ROOT
    process.env.SPINOSA_TEMPLATE_ROOT = repoRoot
    const result = capture()
    try {
      expect(await runSpinosaCli(["--version"], result.io)).toBe(0)
      expect(result.output[0]).toMatch(/^spinosa /)
    } finally {
      if (originalRoot === undefined) delete process.env.SPINOSA_TEMPLATE_ROOT
      else process.env.SPINOSA_TEMPLATE_ROOT = originalRoot
    }
  })
})
