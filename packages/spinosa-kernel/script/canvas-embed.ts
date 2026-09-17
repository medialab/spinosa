/**
 * `@napi-rs/canvas` native embed helpers for Bun --compile packaging.
 *
 * Bun extracts `.node` addons to a temp dir but cannot reliably `require()`
 * optional `@napi-rs/canvas-*` platform packages from nested chunks on Linux.
 * We embed the platform `skia.<triple>.node` and stage it to a real filesystem
 * path before canvas loads (see `src/native/canvas-native.ts`, which sets
 * `NAPI_RS_NATIVE_LIBRARY_PATH` from the document-converter loader).
 */
import fs from "node:fs"
import path from "node:path"

export type CanvasNativeTarget = {
  os: "linux" | "darwin" | "win32"
  arch: "arm64" | "x64"
}

/** Platform optional dependency package for `@napi-rs/canvas` (napi-rs naming). */
export function napiCanvasPlatformPackage(target: CanvasNativeTarget & { abi?: "musl" }): string {
  if (target.os === "darwin") {
    return target.arch === "arm64" ? "@napi-rs/canvas-darwin-arm64" : "@napi-rs/canvas-darwin-x64"
  }
  if (target.os === "linux") {
    const musl = target.abi === "musl"
    if (target.arch === "arm64") {
      return musl ? "@napi-rs/canvas-linux-arm64-musl" : "@napi-rs/canvas-linux-arm64-gnu"
    }
    return musl ? "@napi-rs/canvas-linux-x64-musl" : "@napi-rs/canvas-linux-x64-gnu"
  }
  if (target.os === "win32") {
    return target.arch === "arm64" ? "@napi-rs/canvas-win32-arm64-msvc" : "@napi-rs/canvas-win32-x64-msvc"
  }
  throw new Error(`unsupported canvas platform ${target.os}-${target.arch}`)
}

/** Prefer the highest semver store entry (avoid stale 0.1.x winning over 1.0.2). */
function pickNewestStoreEntry(names: string[], leaf: string): string | undefined {
  const matched = names.filter((name) => name.startsWith(leaf + "@") || name === leaf)
  if (matched.length === 0) return undefined
  matched.sort((a, b) => {
    const va = a.includes("@") ? a.slice(a.lastIndexOf("@") + 1) : "0.0.0"
    const vb = b.includes("@") ? b.slice(b.lastIndexOf("@") + 1) : "0.0.0"
    const pa = va.split(".").map((n) => Number.parseInt(n, 10) || 0)
    const pb = vb.split(".").map((n) => Number.parseInt(n, 10) || 0)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pb[i] ?? 0) - (pa[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  })
  return matched[0]
}

/** Fail closed if the platform canvas native package is not installed for this target. */
export function assertNapiCanvasPlatformInstalled(target: CanvasNativeTarget & { abi?: "musl" }, fromDir: string): string {
  const pkg = napiCanvasPlatformPackage(target)
  const candidates = [
    path.join(fromDir, "node_modules", ...pkg.split("/")),
    path.join(fromDir, "..", "..", "node_modules", ...pkg.split("/")),
    path.join(fromDir, "node_modules", "@napi-rs", pkg.split("/")[1]!),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return fs.realpathSync(candidate)
    }
  }
  // bun store entries look like `@napi-rs+canvas-darwin-x64@1.0.2`
  const storeRoots = [
    path.join(fromDir, "..", "..", "node_modules", ".bun"),
    path.join(fromDir, "node_modules", ".bun"),
  ]
  const leaf = pkg.replace("/", "+")
  for (const store of storeRoots) {
    if (!fs.existsSync(store)) continue
    const newest = pickNewestStoreEntry(fs.readdirSync(store), leaf)
    if (!newest) continue
    const root = path.join(store, newest, "node_modules", ...pkg.split("/"))
    if (fs.existsSync(path.join(root, "package.json"))) return fs.realpathSync(root)
  }
  throw new Error(
    `missing ${pkg} for ${target.os}-${target.arch}. Install with: bun install --os=* --cpu=* @napi-rs/canvas`,
  )
}

/** Absolute path to the platform package's skia.<triple>.node binding. */
export function resolveCanvasSkiaNode(target: CanvasNativeTarget & { abi?: "musl" }, fromDir: string): {
  pkg: string
  packageRoot: string
  name: string
  absolutePath: string
} {
  const pkg = napiCanvasPlatformPackage(target)
  const packageRoot = assertNapiCanvasPlatformInstalled(target, fromDir)
  const meta = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8")) as {
    main?: string
  }
  const name = meta.main
  if (!name || !name.endsWith(".node")) {
    throw new Error(`${pkg} package.json main is not a .node binding: ${name ?? "(missing)"}`)
  }
  const absolutePath = path.join(packageRoot, name)
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size < 1024) {
    throw new Error(`${pkg} skia binding missing or too small: ${absolutePath}`)
  }
  return { pkg, packageRoot, name, absolutePath }
}

export const CANVAS_NATIVE_STUB_MODULE = `// @generated stub — binary builds overwrite via materializeCanvasNativeEmbed
export const CANVAS_NATIVE_BINDING: { name: string; file: string } | null = null
`

/** Restore the tracked stub so platform-specific gen output is not left dirty. */
export function restoreCanvasNativeStub(cwd: string): void {
  fs.writeFileSync(path.join(cwd, "src/generated/canvas-native.gen.ts"), CANVAS_NATIVE_STUB_MODULE)
  fs.rmSync(path.join(cwd, "src/generated/canvas-libs"), { recursive: true, force: true })
}

/**
 * Stage skia.<triple>.node under src/generated/canvas-libs/<os>-<arch>/ and write
 * canvas-native.gen.ts. Bun --compile resolves `with { type: "file" }` imports
 * from real files next to the gen module.
 */
export function materializeCanvasNativeEmbed(options: {
  cwd: string
  target: CanvasNativeTarget & { abi?: "musl" }
  fromDir: string
}): { moduleSource: string; libsDir: string; name: string; absolutePath: string; genPath: string; pkg: string } {
  const resolved = resolveCanvasSkiaNode(options.target, options.fromDir)
  const platformKey = [
    options.target.os,
    options.target.arch,
    options.target.abi,
  ]
    .filter(Boolean)
    .join("-")
  const libsDir = path.join(options.cwd, "src/generated/canvas-libs", platformKey)
  fs.rmSync(libsDir, { recursive: true, force: true })
  fs.mkdirSync(libsDir, { recursive: true })
  const dest = path.join(libsDir, resolved.name)
  fs.copyFileSync(resolved.absolutePath, dest)
  if (fs.statSync(dest).size < 1024) {
    throw new Error(`canvas embed copy too small: ${dest}`)
  }
  const spec = `./canvas-libs/${platformKey}/${resolved.name}`
  const moduleSource = [
    `// @generated by script/canvas-embed.ts — do not edit`,
    `import file_0 from ${JSON.stringify(spec)} with { type: "file" };`,
    ``,
    `export const CANVAS_NATIVE_BINDING = { name: ${JSON.stringify(resolved.name)}, file: file_0 } as const`,
    ``,
  ].join("\n")
  if (!moduleSource.includes('with { type: "file" }') || !moduleSource.includes(resolved.name)) {
    throw new Error(`canvas-native embed module incomplete for ${platformKey}`)
  }
  const genPath = path.join(options.cwd, "src/generated/canvas-native.gen.ts")
  fs.writeFileSync(genPath, moduleSource)
  return {
    moduleSource,
    libsDir,
    name: resolved.name,
    absolutePath: resolved.absolutePath,
    genPath,
    pkg: resolved.pkg,
  }
}

/**
 * Force-embed canvas into the Bun --compile graph without dlopen at TUI boot.
 * The parent imports this module from `loadNapiCanvas()` only when document
 * converters are actually needed. Top-level imports stay so Bun --compile
 * still packs the platform package; Linux relies on the staged
 * `NAPI_RS_NATIVE_LIBRARY_PATH` path instead.
 */
export function napiCanvasForceModule(pkg: string): string {
  return `// @generated — force-embed canvas packages into Bun --compile graph
import ${JSON.stringify(pkg)}
import "@napi-rs/canvas"
export async function loadNapiCanvas() {}
`
}
