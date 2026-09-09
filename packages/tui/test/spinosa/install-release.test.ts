import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { chmod, mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { installedUpgradeVersion, verifyInstallerChecksum } from "@spinosa/core/commands/upgrade"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

describe("install and release flow", () => {
  test("installer dry-run uses immutable platform binary assets", async () => {
    await using tmp = await tmpdir()
    const result = Bun.spawnSync({
      cmd: [
        "bash",
        path.join(repoRoot, "install.sh"),
        "--dry-run",
        "--version",
        "0.8.0-beta.16",
        "--yes",
        "--no-launch",
        "--no-modify-path",
      ],
      cwd: repoRoot,
      env: {
        ...process.env,
        SPINOSA_HOME: path.join(tmp.path, "home"),
        SPINOSA_BIN_DIR: path.join(tmp.path, "bin"),
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`
    expect(result.exitCode).toBe(0)
    expect(output).toMatch(
      /https:\/\/github\.com\/medialab\/spinosa\/releases\/download\/v0\.8\.0-beta\.16\/(spinosa-(darwin|linux)-(arm64|x64)|checksums\.txt)/,
    )
    expect(output).toContain(`/bin/spinosa`)
    expect(output).not.toContain("spinosa-v0.8.0-beta.16.tar.gz")
    expect(output).not.toContain("/versions/")
    expect(output).not.toContain("spinosa-framework-")
    expect(existsSync(path.join(tmp.path, "home"))).toBe(false)
    expect(output).not.toContain("\u001b[")
  })

  test("installer rejects unsafe and foreign install roots without mutating them", async () => {
    await using tmp = await tmpdir()
    const foreignHome = path.join(tmp.path, "foreign")
    const sentinel = path.join(foreignHome, "keep.txt")
    await mkdir(foreignHome, { recursive: true })
    await Bun.write(sentinel, "keep\n")

    const foreign = Bun.spawnSync({
      cmd: ["bash", path.join(repoRoot, "install.sh"), "--dry-run", "--prefix", foreignHome, "--version", "1.0.0"],
      env: { ...process.env, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const root = Bun.spawnSync({
      cmd: ["bash", path.join(repoRoot, "install.sh"), "--dry-run", "--prefix", "/", "--version", "1.0.0"],
      env: { ...process.env, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(foreign.exitCode).toBe(1)
    expect(root.exitCode).toBe(1)
    expect(await Bun.file(sentinel).text()).toBe("keep\n")
  })

  test("installer recognizes legacy Spinosa shims without an ownership marker", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const bin = path.join(tmp.path, "bin")
    const shim = path.join(bin, "spinosa")
    await mkdir(bin, { recursive: true })
    await Bun.write(
      shim,
      ["#!/bin/sh", `home=\"${home}\"`, 'target="${home}/bin/spinosa"', 'exec bash "$target" "$@"', ""].join("\n"),
    )

    const result = Bun.spawnSync({
      cmd: ["bash", "-c", 'installer="$1"; shim="$2"; set --; source "$installer"; is_owned_spinosa_shim "$shim"', "spinosa-test", path.join(repoRoot, "install.sh"), shim],
      env: { ...process.env, SPINOSA_INSTALLER_LIB_ONLY: "1", SPINOSA_HOME: home, SPINOSA_BIN_DIR: bin, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode).toBe(0)
  })

  test("installer uses the TUI wave for indeterminate work", () => {
    const result = Bun.spawnSync({
      cmd: ["bash", "-c", 'installer="$1"; set --; source "$installer"; wave_string 0', "spinosa-test", path.join(repoRoot, "install.sh")],
      env: { ...process.env, SPINOSA_INSTALLER_LIB_ONLY: "1", NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toBe("▁▂▃▄▅▆")
  })

  test("non-TTY steps report lifecycle, enforce timeout, and emit no control bytes", () => {
    const installer = path.join(repoRoot, "install.sh")
    const result = Bun.spawnSync({
      cmd: ["bash", "-c", 'installer="$1"; set --; source "$installer"; run_timed_step "Hung step" 1 bash -c "sleep 5"', "test", installer],
      env: { ...process.env, SPINOSA_INSTALLER_LIB_ONLY: "1", NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = `${result.stdout.toString()}${result.stderr.toString()}`
    expect(result.exitCode).toBe(124)
    expect(output).toContain("Hung step (timeout 1s)")
    expect(output).toContain("timed out after 1s")
    expect(output).not.toContain("\u001b[")
  })

  test("installer never evicts a lock owned by a live process", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    await mkdir(path.join(home, "metadata"), { recursive: true })
    await mkdir(path.join(home, ".staging", ".install.lock"), { recursive: true })
    await Bun.write(path.join(home, "metadata", "config.yaml"), "spinosa: true\n")
    await Bun.write(path.join(home, ".staging", ".install.lock", "pid"), `${process.pid}\n`)

    const result = Bun.spawnSync({
      cmd: ["bash", path.join(repoRoot, "install.sh"), "--yes", "--version", "1.0.0"],
      env: {
        ...process.env,
        SPINOSA_HOME: home,
        SPINOSA_BIN_DIR: path.join(tmp.path, "bin"),
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("Another Spinosa installer is running")
    expect(existsSync(path.join(home, ".staging", ".install.lock"))).toBe(true)
  })

  test("installer compares SemVer without GNU sort", () => {
    const installer = path.join(repoRoot, "install.sh")
    const result = Bun.spawnSync({
      cmd: [
        "bash",
        "-c",
        'installer="$1"; set --; source "$installer"; compare_versions 1.10.0 1.9.0 || a=$?; compare_versions 1.0.0-beta.2 1.0.0-beta.10 || b=$?; compare_versions 1.0.0 1.0.0-rc.1 || c=$?; printf "%s %s %s\\n" "$a" "$b" "$c"',
        "test",
        installer,
      ],
      env: { ...process.env, SPINOSA_INSTALLER_LIB_ONLY: "1", NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toBe("1 2 1")
  })

  test("committed installer version matches package version", async () => {
    const pkg = await Bun.file(path.join(repoRoot, "package.json")).json() as { version: string }
    const installer = await Bun.file(path.join(repoRoot, "install.sh")).text()
    expect(installer).toContain(`PINNED_VERSION="${pkg.version}"`)
  })

  test("binary installer does not ship source-archive dependency install hooks", async () => {
    const pkg = await Bun.file(path.join(repoRoot, "package.json")).json() as {
      trustedDependencies?: string[]
    }
    const lockfile = await Bun.file(path.join(repoRoot, "bun.lock")).text()
    const installer = await Bun.file(path.join(repoRoot, "install.sh")).text()

    expect(pkg.trustedDependencies ?? []).not.toContain("tree-sitter")
    expect(pkg.trustedDependencies ?? []).not.toContain("tree-sitter-bash")
    expect(pkg.trustedDependencies ?? []).not.toContain("tree-sitter-powershell")
    expect(pkg.trustedDependencies ?? []).not.toContain("web-tree-sitter")
    const lockTrustedDependencies = lockfile.match(/\n  "trustedDependencies": \[([\s\S]*?)\n  \],/)?.[1] ?? ""
    expect(lockTrustedDependencies).not.toContain("tree-sitter")
    expect(installer).toContain("SPINOSA_RELEASE_BASE_URL")
    expect(installer).toContain("distribution: binary")
    expect(installer).toContain("ASSET_NAME=")
    expect(installer).not.toContain("install --frozen-lockfile")
    expect(installer).not.toContain("workspace-template/.bin/run-with-timeout.ts")
  })

  test("dependency watchdog terminates a hung process group", () => {
    const runner = path.join(repoRoot, "workspace-template", ".bin", "run-with-timeout.ts")
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", runner, "1", "/bin/sh", "-c", "sleep 2"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode).toBe(124)
    expect(result.stderr.toString()).toContain("command timed out after 1s")
  })

  test("local release pipeline builds product binaries and rolling channel assets", async () => {
    const stages = await Bun.file(path.join(repoRoot, "script", "release", "stages.ts")).text()
    const github = await Bun.file(path.join(repoRoot, "script", "release", "github.ts")).text()
    expect(stages).toContain("publishRollingChannelRelease")
    expect(stages).toContain("build-release-binaries")
    expect(stages).toContain("build-manifest.json")
    expect(stages).not.toContain("git archive --format=tar.gz")
    expect(stages).toContain("checksums.txt")
    expect(stages).toContain("shasum -a 256 install.sh")
    expect(github).toContain("publishRollingChannelRelease")
  })

  test("installer stages binaries under .staging and activates atomically", async () => {
    const installer = await Bun.file(path.join(repoRoot, "install.sh")).text()
    expect(installer).toContain('${SPINOSA_STAGING_DIR}/.install.lock')
    expect(installer).toContain('SPINOSA_STAGING_DIR="${SPINOSA_HOME}/.staging"')
    expect(installer).toContain("activate_binary()")
    expect(installer).toContain('mv "$staged" "$active"')
    expect(installer).toContain("distribution: binary")
    expect(installer).toContain("ASSET_NAME=")
    expect(installer).toContain("SPINOSA_RELEASE_BASE_URL")
    expect(installer).not.toContain("versions/.install.lock")
    expect(installer).not.toContain("install --frozen-lockfile")
    expect(installer).not.toMatch(/ensure_opentui_links\s*\(/)
    expect(installer).not.toContain('--preload "@opentui/solid/preload"')
    // Activation gates fail closed (binary-distribution-contract).
    expect(installer).toContain('die "Template verify failed — refusing to activate staged binary"')
    expect(installer).toContain('die "Template ensure failed — refusing to activate staged binary"')
    expect(installer).toContain('die "Doctor reported issues — refusing to activate staged binary"')
    expect(installer).not.toContain("continuing; doctor will soft-check")
    expect(installer).not.toContain("non-fatal during template soft-check")
    expect(installer).not.toContain("non-fatal if templates are still warming")
  })

  test("patch-local-install refuses binary product installs", async () => {
    const script = await Bun.file(path.join(repoRoot, "script", "patch-local-install.sh")).text()
    expect(script).toContain("is_binary_product_install")
    expect(script).toContain("refusing to patch a binary Spinosa install")
    expect(script).toContain("distribution:[[:space:]]*binary")

    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    await mkdir(path.join(home, "metadata"), { recursive: true })
    await mkdir(path.join(home, "bin"), { recursive: true })
    await Bun.write(
      path.join(home, "metadata", "config.yaml"),
      ["spinosa: true", "distribution: binary", "last_installed_version: 1.0.3-beta.11", ""].join("\n"),
    )
    // ELF magic so the compiled-binary heuristic also trips if metadata were absent.
    await Bun.write(path.join(home, "bin", "spinosa"), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]))
    await chmod(path.join(home, "bin", "spinosa"), 0o755)

    const refused = Bun.spawnSync({
      cmd: ["bash", path.join(repoRoot, "script", "patch-local-install.sh")],
      cwd: repoRoot,
      env: {
        ...process.env,
        SPINOSA_HOME: home,
        SPINOSA_BIN_DIR: path.join(tmp.path, "bin"),
        HOME: tmp.path,
        PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(refused.exitCode).not.toBe(0)
    expect(refused.stderr.toString() + refused.stdout.toString()).toContain("refusing to patch a binary Spinosa install")
    // Must not have overwritten the product binary with a shell forwarder.
    const active = Buffer.from(await Bun.file(path.join(home, "bin", "spinosa")).arrayBuffer())
    expect(active[0]).toBe(0x7f)
    expect(active[1]).toBe(0x45)
  })

  test("installer clears reclaimable virgin debris while refusing owned homes", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    await mkdir(path.join(home, "versions", "broken", "node_modules"), { recursive: true })
    await mkdir(path.join(home, ".staging", ".install.lock"), { recursive: true })
    await mkdir(path.join(home, "bin"), { recursive: true })
    await mkdir(path.join(home, "lib"), { recursive: true })
    await Bun.write(path.join(home, "env.sh"), "keep=no\n")

    const clear = Bun.spawnSync({
      cmd: ["bash", "-c", 'installer="$1"; set --; source "$installer"; clear_virgin_install_debris', "spinosa-test", path.join(repoRoot, "install.sh")],
      cwd: repoRoot,
      env: {
        ...process.env,
        SPINOSA_INSTALLER_LIB_ONLY: "1",
        SPINOSA_HOME: home,
        SPINOSA_BIN_DIR: path.join(tmp.path, "bin"),
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(clear.exitCode).toBe(0)
    expect(existsSync(path.join(home, "versions"))).toBe(false)
    expect(existsSync(path.join(home, ".staging"))).toBe(false)
    expect(existsSync(path.join(home, "env.sh"))).toBe(false)
    expect(existsSync(home)).toBe(true)

    await mkdir(path.join(home, "metadata"), { recursive: true })
    await Bun.write(path.join(home, "metadata", "workspaces.json"), '{"schemaVersion":1,"workspaces":[]}\n')
    await Bun.write(path.join(home, "env.sh"), "owned=yes\n")

    const refused = Bun.spawnSync({
      cmd: ["bash", "-c", 'installer="$1"; set --; source "$installer"; clear_virgin_install_debris', "spinosa-test", path.join(repoRoot, "install.sh")],
      cwd: repoRoot,
      env: {
        ...process.env,
        SPINOSA_INSTALLER_LIB_ONLY: "1",
        SPINOSA_HOME: home,
        SPINOSA_BIN_DIR: path.join(tmp.path, "bin"),
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(refused.exitCode).not.toBe(0)
    expect(await Bun.file(path.join(home, "metadata", "workspaces.json")).text()).toBe('{"schemaVersion":1,"workspaces":[]}\n')
    expect(await Bun.file(path.join(home, "env.sh")).text()).toBe("owned=yes\n")
  })

  test("workspace launcher forwards to the installed binary and reports missing installs", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const launcher = await Bun.file(path.join(repoRoot, "workspace-template", ".bin", "spinosa")).text()
    await mkdir(path.join(home, "bin"), { recursive: true })
    await Bun.write(path.join(tmp.path, "launcher"), launcher)
    await chmod(path.join(tmp.path, "launcher"), 0o755)

    const missing = Bun.spawnSync({
      cmd: [path.join(tmp.path, "launcher"), "version"],
      cwd: tmp.path,
      env: { ...process.env, SPINOSA_HOME: home, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(missing.exitCode).toBe(1)
    expect(missing.stderr.toString()).toContain("installed binary is missing")

    await Bun.write(path.join(home, "bin", "spinosa"), ["#!/bin/sh", 'echo "product binary"', ""].join("\n"))
    await chmod(path.join(home, "bin", "spinosa"), 0o755)

    const ok = Bun.spawnSync({
      cmd: [path.join(tmp.path, "launcher"), "version"],
      cwd: tmp.path,
      env: { ...process.env, SPINOSA_HOME: home, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(ok.exitCode).toBe(0)
    expect(ok.stdout.toString()).toContain("product binary")
  })

  test("uninstaller rejects a non-Spinosa home", async () => {
    await using tmp = await tmpdir()
    const sentinel = path.join(tmp.path, "keep.txt")
    await Bun.write(sentinel, "keep\n")
    const result = Bun.spawnSync({
      cmd: ["bash", path.join(repoRoot, "workspace-template", ".bin", "spinosa"), "uninstall", "--yes"],
      cwd: repoRoot,
      env: { ...process.env, SPINOSA_HOME: tmp.path, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(result.exitCode).toBe(1)
    expect(await Bun.file(sentinel).text()).toBe("keep\n")
  })

  test("workspace launcher is a minimal binary forwarder", async () => {
    const launcher = await Bun.file(path.join(repoRoot, "workspace-template", ".bin", "spinosa")).text()
    expect(launcher).toContain('home="${SPINOSA_HOME:-$HOME/.spinosa}"')
    expect(launcher).toContain('target="$home/bin/spinosa"')
    expect(launcher).toContain('exec "$target" "$@"')
    expect(launcher).toContain("Managed by Spinosa binary distribution")
    expect(launcher).not.toContain('"${SCRIPT_DIR}/../versions"')
    expect(launcher).not.toContain("link_opentui_packages()")
    expect(launcher).not.toContain('--preload "@opentui/solid/preload"')
    expect(launcher).not.toContain("exec_kernel()")
  })

  test("rejects installer checksum mismatch", () => {
    const installer = "#!/bin/bash\necho ok\n"
    expect(verifyInstallerChecksum(installer, `${Bun.CryptoHasher.hash("sha256", installer, "hex")}  install.sh\n`)).toBe(true)
    expect(verifyInstallerChecksum(`${installer}# changed\n`, `${Bun.CryptoHasher.hash("sha256", installer, "hex")}  install.sh\n`)).toBe(false)
  })

  test("verifies an upgrade against the newly installed binary metadata", async () => {
    await using tmp = await tmpdir()
    await mkdir(path.join(tmp.path, "bin"), { recursive: true })
    await mkdir(path.join(tmp.path, "metadata"), { recursive: true })
    await Bun.write(
      path.join(tmp.path, "metadata", "config.yaml"),
      ["spinosa: true", "distribution: binary", "last_installed_version: 1.2.3", ""].join("\n"),
    )
    await Bun.write(path.join(tmp.path, "bin", "spinosa"), ["#!/bin/sh", "exit 0", ""].join("\n"))
    await chmod(path.join(tmp.path, "bin", "spinosa"), 0o755)

    expect(installedUpgradeVersion("1.2.3", tmp.path)).toBe("1.2.3")
  })
})
