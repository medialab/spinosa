import { Config } from "effect"

function legacyKey(key: string) {
  return key.startsWith("SPINOSA_") ? `OPENCODE_${key.slice("SPINOSA_".length)}` : undefined
}

export function value(key: string, source: NodeJS.ProcessEnv = process.env) {
  const legacy = legacyKey(key)
  return source[key] ?? (legacy ? source[legacy] : undefined)
}

export function truthy(key: string, source: NodeJS.ProcessEnv = process.env) {
  const entry = value(key, source)?.toLowerCase()
  return entry === "true" || entry === "1"
}

const copy = value("SPINOSA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
const fff = value("SPINOSA_DISABLE_FFF")
let modelsFetchDisabledOverride: boolean | undefined

function enabledByExperimental(key: string) {
  return value(key) === undefined ? truthy("SPINOSA_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  SPINOSA_AUTO_HEAP_SNAPSHOT: truthy("SPINOSA_AUTO_HEAP_SNAPSHOT"),
  SPINOSA_GIT_BASH_PATH: value("SPINOSA_GIT_BASH_PATH"),
  SPINOSA_CONFIG: value("SPINOSA_CONFIG"),
  get SPINOSA_CONFIG_CONTENT() {
    return value("SPINOSA_CONFIG_CONTENT")
  },
  SPINOSA_DISABLE_AUTOUPDATE: truthy("SPINOSA_DISABLE_AUTOUPDATE"),
  SPINOSA_ALWAYS_NOTIFY_UPDATE: truthy("SPINOSA_ALWAYS_NOTIFY_UPDATE"),
  SPINOSA_DISABLE_PRUNE: truthy("SPINOSA_DISABLE_PRUNE"),
  SPINOSA_DISABLE_TERMINAL_TITLE: truthy("SPINOSA_DISABLE_TERMINAL_TITLE"),
  SPINOSA_SHOW_TTFD: truthy("SPINOSA_SHOW_TTFD"),
  SPINOSA_DISABLE_AUTOCOMPACT: truthy("SPINOSA_DISABLE_AUTOCOMPACT"),
  // Access-time: smoke/workers set the env after this module loads; tests assign the flag.
  get SPINOSA_DISABLE_MODELS_FETCH() {
    return modelsFetchDisabledOverride ?? truthy("SPINOSA_DISABLE_MODELS_FETCH")
  },
  set SPINOSA_DISABLE_MODELS_FETCH(value: boolean | undefined) {
    modelsFetchDisabledOverride = value
  },
  SPINOSA_DISABLE_MOUSE: truthy("SPINOSA_DISABLE_MOUSE"),
  SPINOSA_FAKE_VCS: value("SPINOSA_FAKE_VCS"),
  SPINOSA_SERVER_PASSWORD: value("SPINOSA_SERVER_PASSWORD"),
  SPINOSA_SERVER_USERNAME: value("SPINOSA_SERVER_USERNAME"),
  SPINOSA_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("SPINOSA_DISABLE_FFF"),

  // Experimental
  SPINOSA_EXPERIMENTAL_FILEWATCHER: Config.boolean("SPINOSA_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  SPINOSA_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("SPINOSA_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  SPINOSA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("SPINOSA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  SPINOSA_MODELS_URL: value("SPINOSA_MODELS_URL"),
  SPINOSA_MODELS_PATH: value("SPINOSA_MODELS_PATH"),
  SPINOSA_DB: value("SPINOSA_DB"),

  SPINOSA_WORKSPACE_ID: value("SPINOSA_WORKSPACE_ID"),
  SPINOSA_EXPERIMENTAL_WORKSPACES: enabledByExperimental("SPINOSA_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get SPINOSA_DISABLE_PROJECT_CONFIG() {
    return truthy("SPINOSA_DISABLE_PROJECT_CONFIG")
  },
  get SPINOSA_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("SPINOSA_EXPERIMENTAL_REFERENCES")
  },
  get SPINOSA_TUI_CONFIG() {
    return value("SPINOSA_TUI_CONFIG")
  },
  get SPINOSA_CONFIG_DIR() {
    return value("SPINOSA_CONFIG_DIR")
  },
  get SPINOSA_PURE() {
    return truthy("SPINOSA_PURE")
  },
  get SPINOSA_PERMISSION() {
    return value("SPINOSA_PERMISSION")
  },
  get SPINOSA_PLUGIN_META_FILE() {
    return value("SPINOSA_PLUGIN_META_FILE")
  },
  get SPINOSA_CLIENT() {
    return value("SPINOSA_CLIENT") ?? "cli"
  },
}
