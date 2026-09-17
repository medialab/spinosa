import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const APP = "spinosa"

export type UserDirKind = "data" | "config" | "cache" | "state"

export type UserDirsInput = {
  platform?: NodeJS.Platform
  home?: string
  env?: NodeJS.ProcessEnv
  exists?: (file: string) => boolean
}

function userHome(input: UserDirsInput = {}): string {
  if (input.home) return input.home
  if (input.env?.SPINOSA_TEST_HOME) return input.env.SPINOSA_TEST_HOME
  if (process.env.SPINOSA_TEST_HOME) return process.env.SPINOSA_TEST_HOME
  return homedir()
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  if (value && path.isAbsolute(value)) return value
  return undefined
}

/** User cache root without the app name (`~/.cache` or `~/Library/Caches`). */
export function userCacheHome(input: UserDirsInput = {}): string {
  const env = input.env ?? process.env
  const fromEnv = envValue(env, "XDG_CACHE_HOME")
  if (fromEnv) return fromEnv
  const home = userHome(input)
  const platform = input.platform ?? process.platform
  if (platform === "darwin") return path.join(home, "Library", "Caches")
  return path.join(home, ".cache")
}

export function userConfigHome(input: UserDirsInput = {}): string {
  const env = input.env ?? process.env
  const fromEnv = envValue(env, "XDG_CONFIG_HOME")
  if (fromEnv) return fromEnv
  const home = userHome(input)
  const platform = input.platform ?? process.platform
  if (platform === "darwin") return path.join(home, "Library", "Application Support")
  return path.join(home, ".config")
}

export function userDataHome(input: UserDirsInput = {}): string {
  const env = input.env ?? process.env
  const fromEnv = envValue(env, "XDG_DATA_HOME")
  if (fromEnv) return fromEnv
  const home = userHome(input)
  const platform = input.platform ?? process.platform
  if (platform === "darwin") return path.join(home, "Library", "Application Support")
  return path.join(home, ".local", "share")
}

export function userStateHome(input: UserDirsInput = {}): string {
  const env = input.env ?? process.env
  const fromEnv = envValue(env, "XDG_STATE_HOME")
  if (fromEnv) return fromEnv
  const home = userHome(input)
  const platform = input.platform ?? process.platform
  if (platform === "darwin") return path.join(home, "Library", "Application Support")
  return path.join(home, ".local", "state")
}

function xdgAppDir(kind: UserDirKind, home: string): string {
  switch (kind) {
    case "data":
      return path.join(home, ".local", "share", APP)
    case "config":
      return path.join(home, ".config", APP)
    case "cache":
      return path.join(home, ".cache", APP)
    case "state":
      return path.join(home, ".local", "state", APP)
  }
}

function nativeAppDir(kind: UserDirKind, platform: NodeJS.Platform, home: string): string {
  if (platform !== "darwin") return xdgAppDir(kind, home)
  switch (kind) {
    case "data":
      return path.join(home, "Library", "Application Support", APP, "data")
    case "config":
      return path.join(home, "Library", "Application Support", APP, "config")
    case "cache":
      return path.join(home, "Library", "Caches", APP)
    case "state":
      return path.join(home, "Library", "Application Support", APP, "state")
  }
}

/**
 * App directory for data/config/cache/state.
 * Honors XDG_* on every OS. On macOS, new installs use Library paths;
 * existing `~/.config/spinosa` (and siblings) stay in use so we do not
 * strand auth or session files.
 */
export function resolveUserDir(kind: UserDirKind, input: UserDirsInput = {}): string {
  const env = input.env ?? process.env
  const xdgKey = {
    data: "XDG_DATA_HOME",
    config: "XDG_CONFIG_HOME",
    cache: "XDG_CACHE_HOME",
    state: "XDG_STATE_HOME",
  }[kind]
  const fromEnv = envValue(env, xdgKey)
  if (fromEnv) return path.join(fromEnv, APP)

  const home = userHome(input)
  const platform = input.platform ?? process.platform
  const native = nativeAppDir(kind, platform, home)
  if (platform !== "darwin") return native

  const exists = input.exists ?? existsSync
  const legacy = xdgAppDir(kind, home)
  if (exists(native)) return native
  if (exists(legacy)) return legacy
  return native
}

export function resolveUserDirs(input: UserDirsInput = {}): {
  data: string
  config: string
  cache: string
  state: string
  bin: string
  repos: string
} {
  const data = resolveUserDir("data", input)
  const cache = resolveUserDir("cache", input)
  return {
    data,
    config: resolveUserDir("config", input),
    cache,
    state: resolveUserDir("state", input),
    bin: path.join(cache, "bin"),
    repos: path.join(data, "repos"),
  }
}

/** Product install root (`$SPINOSA_HOME`, default `~/.spinosa` on Linux and macOS). */
export function productHomeDir(input: UserDirsInput = {}): string {
  const env = input.env ?? process.env
  if (env.SPINOSA_HOME) return env.SPINOSA_HOME
  return path.join(userHome(input), ".spinosa")
}

export function productLogDir(input: UserDirsInput = {}): string {
  return path.join(productHomeDir(input), "logs")
}

function isUnderDir(token: string, dir: string): boolean {
  return token === dir || token.startsWith(`${dir}/`)
}

function hasAppSegment(token: string, segment: string): boolean {
  return token === segment || token.includes(`/${segment}/`) || token.endsWith(`/${segment}`)
}

/**
 * Product install / XDG / Library app dirs. Workspace marker folders
 * (`…/corpus/.spinosa/…`) are not product paths.
 */
export function isRuntimeProductPath(token: string): boolean {
  const normalized = token.replaceAll("\\", "/")
  if (isUnderDir(normalized, "~/.spinosa") || isUnderDir(normalized, "$SPINOSA_HOME")) return true
  if (/^\/(?:Users|home)\/[^/]+\/\.spinosa(?:\/|$)/.test(normalized)) return true
  return (
    hasAppSegment(normalized, "Library/Application Support/spinosa") ||
    hasAppSegment(normalized, "Library/Caches/spinosa") ||
    hasAppSegment(normalized, ".config/spinosa") ||
    hasAppSegment(normalized, ".local/share/spinosa") ||
    hasAppSegment(normalized, ".local/state/spinosa") ||
    hasAppSegment(normalized, ".cache/spinosa")
  )
}
