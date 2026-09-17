import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  isRuntimeProductPath,
  productHomeDir,
  productLogDir,
  resolveUserDir,
  resolveUserDirs,
  userCacheHome,
} from "../src/util/user-dirs"

const home = "/Users/name"
const linuxHome = "/home/name"
const existsNone = () => false

describe("user dirs", () => {
  test("linux uses XDG defaults when env is unset", () => {
    const env = {}
    expect(resolveUserDir("data", { platform: "linux", home: linuxHome, env, exists: existsNone })).toBe(
      path.join(linuxHome, ".local", "share", "spinosa"),
    )
    expect(resolveUserDir("config", { platform: "linux", home: linuxHome, env, exists: existsNone })).toBe(
      path.join(linuxHome, ".config", "spinosa"),
    )
    expect(resolveUserDir("cache", { platform: "linux", home: linuxHome, env, exists: existsNone })).toBe(
      path.join(linuxHome, ".cache", "spinosa"),
    )
    expect(resolveUserDir("state", { platform: "linux", home: linuxHome, env, exists: existsNone })).toBe(
      path.join(linuxHome, ".local", "state", "spinosa"),
    )
    expect(userCacheHome({ platform: "linux", home: linuxHome, env })).toBe(path.join(linuxHome, ".cache"))
  })

  test("darwin uses Library paths for new installs", () => {
    const env = {}
    expect(resolveUserDir("data", { platform: "darwin", home, env, exists: existsNone })).toBe(
      path.join(home, "Library", "Application Support", "spinosa", "data"),
    )
    expect(resolveUserDir("config", { platform: "darwin", home, env, exists: existsNone })).toBe(
      path.join(home, "Library", "Application Support", "spinosa", "config"),
    )
    expect(resolveUserDir("cache", { platform: "darwin", home, env, exists: existsNone })).toBe(
      path.join(home, "Library", "Caches", "spinosa"),
    )
    expect(resolveUserDir("state", { platform: "darwin", home, env, exists: existsNone })).toBe(
      path.join(home, "Library", "Application Support", "spinosa", "state"),
    )
    expect(userCacheHome({ platform: "darwin", home, env })).toBe(path.join(home, "Library", "Caches"))
  })

  test("darwin keeps existing XDG app dirs so auth is not stranded", () => {
    const env = {}
    const legacy = path.join(home, ".local", "share", "spinosa")
    expect(
      resolveUserDir("data", {
        platform: "darwin",
        home,
        env,
        exists: (file) => file === legacy,
      }),
    ).toBe(legacy)
  })

  test("XDG env wins on darwin and linux", () => {
    const env = {
      XDG_DATA_HOME: "/custom/data",
      XDG_CONFIG_HOME: "/custom/config",
      XDG_CACHE_HOME: "/custom/cache",
      XDG_STATE_HOME: "/custom/state",
    }
    for (const platform of ["darwin", "linux"] as const) {
      expect(resolveUserDir("data", { platform, home, env, exists: existsNone })).toBe("/custom/data/spinosa")
      expect(resolveUserDir("config", { platform, home, env, exists: existsNone })).toBe("/custom/config/spinosa")
      expect(resolveUserDir("cache", { platform, home, env, exists: existsNone })).toBe("/custom/cache/spinosa")
      expect(resolveUserDir("state", { platform, home, env, exists: existsNone })).toBe("/custom/state/spinosa")
    }
  })

  test("product home stays ~/.spinosa on both OS", () => {
    const env = {}
    expect(productHomeDir({ platform: "darwin", home, env })).toBe(path.join(home, ".spinosa"))
    expect(productHomeDir({ platform: "linux", home: linuxHome, env })).toBe(path.join(linuxHome, ".spinosa"))
    expect(productLogDir({ home, env })).toBe(path.join(home, ".spinosa", "logs"))
    expect(productHomeDir({ home, env: { SPINOSA_HOME: "/opt/spinosa" } })).toBe("/opt/spinosa")
  })

  test("kernel tool bin lives under the OS cache dir", () => {
    const dirs = resolveUserDirs({ platform: "linux", home: linuxHome, env: {}, exists: existsNone })
    expect(dirs.bin).toBe(path.join(dirs.cache, "bin"))
    expect(dirs.repos).toBe(path.join(dirs.data, "repos"))
  })

  test("product path keeps install home and drops workspace .spinosa markers", () => {
    expect(isRuntimeProductPath("/Users/name/.spinosa/logs/boot.ndjson")).toBe(true)
    expect(isRuntimeProductPath("~/.spinosa/logs/effect.log")).toBe(true)
    expect(isRuntimeProductPath("/Users/name/Downloads/ARCHIVE/.spinosa/memory/notes.md")).toBe(false)
    expect(isRuntimeProductPath("/home/name/Downloads/ws/.spinosa/workspace")).toBe(false)
  })
})
