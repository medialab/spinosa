import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  listFrameworkManifestFiles,
  buildTemplatePackMeta,
  computeTemplatePackId,
  extractTemplatePackAtomic,
  assertSafePackRelativePath,
  type EmbeddedTemplatePack,
} from "../src/framework/template-pack"
import {
  resolveProductBinaryTarget,
  productBinaryAssetName,
  PRODUCT_BINARY_TARGETS,
  expectedImmutableReleaseAssets,
  isMuslLinux,
  MUSL_UNSUPPORTED_MESSAGE,
} from "../src/distribution/contract"
import {
  BINARY_WORKSPACE_LAUNCHER,
  classifyWorkspaceLauncher,
  migrateWorkspaceLaunchers,
} from "../src/distribution/workspace-launcher"
import {
  readDoctorUnverifiedReason,
  clearDoctorUnverifiedReason,
  readInstalledBinaryVersion,
} from "../src/distribution/bootstrap"

const repoRoot = join(import.meta.dir, "../../..")
const templateRoot = join(repoRoot, "workspace-template")

describe("distribution contract", () => {
  test("maps amd64/x86_64 to x64 assets", () => {
    expect(resolveProductBinaryTarget({ os: "Darwin", arch: "x86_64" })).toBe("darwin-x64")
    expect(resolveProductBinaryTarget({ os: "Linux", arch: "amd64" })).toBe("linux-x64")
    expect(productBinaryAssetName("linux-x64")).toBe("spinosa-linux-x64")
    expect(expectedImmutableReleaseAssets("1.0.0")).toContain("spinosa-darwin-arm64")
    expect(expectedImmutableReleaseAssets("1.0.0")).not.toContain("spinosa-v1.0.0.tar.gz")
    expect(PRODUCT_BINARY_TARGETS).toHaveLength(4)
  })

  test("rejects unsupported platforms", () => {
    expect(() => resolveProductBinaryTarget({ os: "Windows_NT", arch: "x64" })).toThrow(/Unsupported OS/)
  })

  test("rejects explicit musl libc", () => {
    expect(() => resolveProductBinaryTarget({ os: "Linux", arch: "x64", libc: "musl" })).toThrow(
      MUSL_UNSUPPORTED_MESSAGE,
    )
    expect(() => resolveProductBinaryTarget({ os: "linux", arch: "arm64", libc: "musl" })).toThrow(/musl/)
  })

  test("isMuslLinux probe hints match install.sh classifier", () => {
    expect(isMuslLinux({ platform: "darwin", alpineReleaseExists: true })).toBe(false)
    expect(isMuslLinux({ platform: "linux", alpineReleaseExists: true })).toBe(true)
    expect(isMuslLinux({ platform: "linux", ldMuslPresent: true })).toBe(true)
    expect(
      isMuslLinux({
        platform: "linux",
        alpineReleaseExists: false,
        ldMuslPresent: false,
        lddVersionText: "musl libc (x86_64)\nVersion 1.2.4",
      }),
    ).toBe(true)
    expect(
      isMuslLinux({
        platform: "linux",
        alpineReleaseExists: false,
        ldMuslPresent: false,
        lddVersionText: "ldd (GNU libc) 2.39",
      }),
    ).toBe(false)
  })

  test("explicit gnu libc bypasses host musl auto-detect", () => {
    // Cross-resolve escape hatch: callers mapping linux assets from any host.
    expect(resolveProductBinaryTarget({ os: "Linux", arch: "x64", libc: "gnu" })).toBe("linux-x64")
    expect(resolveProductBinaryTarget({ os: "Linux", arch: "arm64", libc: "glibc" })).toBe("linux-arm64")
  })
})

describe("template pack", () => {
  test("enumerates manifest files without node_modules", () => {
    const files = listFrameworkManifestFiles(templateRoot)
    expect(files.length).toBeGreaterThan(10)
    expect(files.some((f) => f.relativePath.includes("node_modules"))).toBe(false)
    expect(files.some((f) => f.relativePath === ".bin/spinosa")).toBe(true)
    expect(files.some((f) => f.relativePath === ".spinosa/workspace-files.tsv")).toBe(true)
    const a = computeTemplatePackId(files)
    const b = computeTemplatePackId(files)
    expect(a).toBe(b)
  })

  test("rejects path traversal", () => {
    expect(() => assertSafePackRelativePath("../etc/passwd")).toThrow()
    expect(() => assertSafePackRelativePath("/etc/passwd")).toThrow()
  })

  test("atomic extract writes completion marker and verifies", () => {
    const files = listFrameworkManifestFiles(templateRoot).slice(0, 5)
    const meta = buildTemplatePackMeta("1.0.3-beta.10", files)
    const pack: EmbeddedTemplatePack = {
      version: meta.version,
      packId: meta.packId,
      files: files.map((f) => ({
        path: f.relativePath,
        mode: f.mode,
        sha256: f.sha256,
        content: readFileSync(f.sourcePath, "utf-8"),
      })),
    }
    const cache = join(tmpdir(), `spinosa-pack-${Date.now()}`)
    try {
      const result = extractTemplatePackAtomic(pack, cache)
      expect(result.ok).toBe(true)
      expect(existsSync(join(cache, ".spinosa", ".pack-complete"))).toBe(true)
      expect(existsSync(join(cache, ".spinosa", "template-pack.json"))).toBe(true)
    } finally {
      rmSync(cache, { recursive: true, force: true })
    }
  })
})

describe("workspace launcher migration", () => {
  test("migrates managed source launchers and preserves modified", () => {
    const root = join(tmpdir(), `spinosa-launcher-${Date.now()}`)
    const managed = join(root, "managed")
    const modified = join(root, "modified")
    mkdirSync(join(managed, ".bin"), { recursive: true })
    mkdirSync(join(modified, ".bin"), { recursive: true })
    writeFileSync(
      join(managed, ".bin", "spinosa"),
      "#!/bin/bash\n# Resolves the framework root and Bun runtime\ncandidate=\"${SCRIPT_DIR}/..\"\npackages/spinosa-kernel/src/index.ts\n",
      { mode: 0o755 },
    )
    writeFileSync(join(modified, ".bin", "spinosa"), "#!/bin/sh\necho custom\n", { mode: 0o755 })
    chmodSync(join(managed, ".bin", "spinosa"), 0o755)
    chmodSync(join(modified, ".bin", "spinosa"), 0o755)

    expect(classifyWorkspaceLauncher(join(managed, ".bin", "spinosa")).status).toBe("managed-source")
    expect(classifyWorkspaceLauncher(join(modified, ".bin", "spinosa")).status).toBe("modified")

    const result = migrateWorkspaceLaunchers([managed, modified])
    expect(result.migrated).toContain(join(managed, ".bin", "spinosa"))
    expect(result.preserved).toContain(join(modified, ".bin", "spinosa"))
    expect(readFileSync(join(managed, ".bin", "spinosa"), "utf-8")).toBe(BINARY_WORKSPACE_LAUNCHER)
    expect(readFileSync(join(modified, ".bin", "spinosa"), "utf-8")).toContain("custom")
    rmSync(root, { recursive: true, force: true })
  })
})

describe("install health metadata", () => {
  test("reads doctor_unverified flag from install metadata", () => {
    const home = join(tmpdir(), `spinosa-doctor-flag-${Date.now()}`)
    try {
      expect(readDoctorUnverifiedReason(home)).toBe("")
      mkdirSync(join(home, "metadata"), { recursive: true })
      writeFileSync(
        join(home, "metadata", "config.yaml"),
        'spinosa: true\ndoctor_unverified: "timeout"\nlast_installed_version: "1.1.0-beta.29"\n',
      )
      expect(readDoctorUnverifiedReason(home)).toBe("timeout")
      expect(readInstalledBinaryVersion(home)).toBe("1.1.0-beta.29")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("clears a stale doctor_unverified flag without touching other keys", () => {
    const home = join(tmpdir(), `spinosa-doctor-clear-${Date.now()}`)
    try {
      expect(clearDoctorUnverifiedReason(home)).toBe(false)
      mkdirSync(join(home, "metadata"), { recursive: true })
      writeFileSync(
        join(home, "metadata", "config.yaml"),
        'spinosa: true\ndoctor_unverified: "timeout"\nlast_installed_version: "1.1.0-beta.29"\n',
      )
      expect(clearDoctorUnverifiedReason(home)).toBe(true)
      expect(readDoctorUnverifiedReason(home)).toBe("")
      expect(readInstalledBinaryVersion(home)).toBe("1.1.0-beta.29")
      expect(clearDoctorUnverifiedReason(home)).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
