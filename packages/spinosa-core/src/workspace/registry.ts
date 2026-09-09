import { chmodSync, existsSync, mkdirSync, readdirSync, openSync, closeSync, fsyncSync } from "node:fs"
import { chmod, mkdir, rename, rm, stat, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { spinosaLogWarn } from "../utils/log"
import { writeYamlConfig } from "../utils/yaml-config"
import { resolveWorkspaceDisplayName } from "../workspace-name"
import type { SpinosaRegisteredWorkspace, SpinosaSetupStatus, SpinosaWorkspacePresence } from "../types"
import { ensureWorkspaceID, parseWorkspaceID, readWorkspaceID, type SpinosaWorkspaceID } from "./identity"
import { readWorkspaceMeta } from "./meta"

export const WORKSPACE_REGISTRY_SCHEMA_VERSION = 1
export const WORKSPACE_REGISTRY_FILENAME = "workspaces.json"
export const LEGACY_WORKSPACE_REGISTRY_FILENAME = "workspaces.txt"

export type WorkspaceRegistryEntry = {
  path: string
  name: string
  workspaceID?: SpinosaWorkspaceID
  presence: SpinosaWorkspacePresence
  setupStatus: SpinosaSetupStatus
  registeredAt: string
  lastSeenAt?: string
  tags: string[]
}

type WorkspaceRegistryDocument = {
  schemaVersion: typeof WORKSPACE_REGISTRY_SCHEMA_VERSION
  workspaces: WorkspaceRegistryEntry[]
}
// In-process mutex serializing registry file read-modify-write cycles
let registryLock: Promise<void> = Promise.resolve()

function withRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = registryLock
    .then(fn, fn) // recover from previous rejection and still run fn
  registryLock = next.then(() => {}, () => {}) // keep chain alive even if fn rejects
  return next
}

function spinosaHome(): string {
  return process.env.SPINOSA_HOME ?? path.join(homedir(), ".spinosa")
}

function metadataPath(...segments: string[]): string {
  return path.join(spinosaHome(), "metadata", ...segments)
}

// Single-pass escape using a longest-match replacer so a literal "%" that
// precedes a digit sequence is never mis-decoded.
const REGISTRY_ESCAPE_RE = /%25|%0A|%0D|%7C/gi
export function registryEscape(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\|/g, "%7C")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
}

export function registryUnescape(value: string): string {
  return value.replace(REGISTRY_ESCAPE_RE, (m) => {
    switch (m.toUpperCase()) {
      case "%25": return "%"
      case "%0A": return "\n"
      case "%0D": return "\r"
      case "%7C": return "|"
      default: return m
    }
  })
}

const REGISTRY_LOCK_TIMEOUT_MS = 8_000

// Read the owner pid recorded inside a lock dir; returns null if unreadable.
async function readLockOwnerPid(lockDir: string): Promise<number | null> {
  try {
    const raw = await readFile(path.join(lockDir, "pid"), "utf8")
    const pid = Number.parseInt(raw.trim(), 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

// A process is considered alive if we can signal it (kill(pid,0) succeeds).
function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function acquireRegistryFileLock(
  registry: string,
  onRecover?: (msg: string) => void,
): Promise<() => Promise<void>> {
  const lockDir = `${registry}.lock`
  const deadline = Date.now() + REGISTRY_LOCK_TIMEOUT_MS
  let forceReclaimed = false
  while (true) {
    try {
      await mkdir(lockDir, { mode: 0o700 })
      // Record our pid so a later holder can tell whether we are still alive.
      await writeFile(path.join(lockDir, "pid"), String(process.pid), { encoding: "utf8", mode: 0o600 }).catch(() => {})
      return async () => { await rm(lockDir, { recursive: true, force: true }) }
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error
      if (!forceReclaimed && Date.now() >= deadline) {
        // Delay stale-lock reclamation until the deadline. A process can exit
        // after releasing its lock while another process immediately reuses
        // the same directory; eager PID-based removal can then steal the new
        // owner's lock (an ABA race).
        const currentOwnerPid = await readLockOwnerPid(lockDir)
        if (currentOwnerPid === null || currentOwnerPid <= 0 || !isProcessAlive(currentOwnerPid)) {
          forceReclaimed = true
          await rm(lockDir, { recursive: true, force: true }).catch(() => {})
          onRecover?.("Cleared a stale registry lock left by a previous run.")
          continue
        }
      }
      await Bun.sleep(20)
    }
  }
}

async function writeRegistryAtomically(registry: string, content: string, updateBackup = true): Promise<void> {
  const tmp = `${registry}.tmp-${process.pid}-${crypto.randomUUID()}`
  await Bun.write(tmp, content)
  await chmod(tmp, 0o600)
  // fsync the temp file before renaming so a crash mid-rename cannot leave a
  // partial registry on network/FUSE-backed filesystems.
  try {
    const fd = openSync(tmp, "r+")
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    // best-effort; rename still proceeds
  }
  try {
    await rename(tmp, registry)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
  if (updateBackup) {
    try {
      await writeRegistryAtomically(`${registry}.bak`, content, false)
    } catch {
      // The primary rename already committed atomically; backup refresh is repair-only.
    }
  }
}

async function withRegistryFileLock<T>(
  registry: string,
  fn: () => Promise<T>,
  onRecover?: (msg: string) => void,
): Promise<T> {
  const release = await acquireRegistryFileLock(registry, onRecover)
  try {
    return await fn()
  } finally {
    await release()
  }
}

type DecodedRegistryLine = {
  workspacePath: string
  project: string
  registered: string
  workspaceID?: SpinosaWorkspaceID
  presence?: SpinosaWorkspacePresence
}

function decodeRegistryLine(line: string): DecodedRegistryLine | undefined {
  const [rawPath, rawProject = "", registered = "", rawWorkspaceID, rawPresence] = line.split("|")
  if (!rawPath) return
  return {
    workspacePath: registryUnescape(rawPath),
    project: registryUnescape(rawProject),
    registered,
    workspaceID: parseWorkspaceID(rawWorkspaceID),
    presence: parseWorkspacePresence(rawPresence),
  }
}

function parseWorkspacePresence(value: string | undefined): SpinosaWorkspacePresence | undefined {
  switch (value) {
    case "unknown":
    case "present":
    case "legacy":
    case "moved":
    case "non_existent":
    case "invalid":
    case "identity_mismatch":
      return value
    default:
      return undefined
  }
}

function parseSetupStatus(value: unknown): SpinosaSetupStatus {
  switch (value) {
    case "not_started":
    case "importing":
    case "cli_started":
    case "workspace_started":
    case "unknown":
      return value
    default:
      return "unknown"
  }
}

function workspaceIDFromMarker(workspacePath: string): SpinosaWorkspaceID | undefined {
  return readWorkspaceID(workspacePath)
}

function emptyRegistryDocument(): WorkspaceRegistryDocument {
  return { schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION, workspaces: [] }
}

function parseRegistryDocument(text: string, registry: string): WorkspaceRegistryDocument {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`Workspace registry is not valid JSON at ${registry}`, { cause: error })
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Workspace registry must be an object at ${registry}`)
  }
  const input = raw as Record<string, unknown>
  if (input.schemaVersion !== WORKSPACE_REGISTRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported workspace registry schema version at ${registry}`)
  }
  if (!Array.isArray(input.workspaces)) {
    throw new Error(`Workspace registry must contain a workspaces array at ${registry}`)
  }

  const workspaces = input.workspaces.map((value, index): WorkspaceRegistryEntry => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid workspace registry record ${index + 1} at ${registry}`)
    }
    const record = value as Record<string, unknown>
    const state = record.state
    const registration = record.registration
    if (typeof record.path !== "string" || !record.path || typeof record.name !== "string") {
      throw new Error(`Invalid workspace path or name in registry record ${index + 1} at ${registry}`)
    }
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error(`Invalid workspace state in registry record ${index + 1} at ${registry}`)
    }
    if (!registration || typeof registration !== "object" || Array.isArray(registration)) {
      throw new Error(`Invalid workspace registration in record ${index + 1} at ${registry}`)
    }
    const rawID = record.id
    const workspaceID = typeof rawID === "string" ? parseWorkspaceID(rawID) : undefined
    if (rawID !== undefined && !workspaceID) {
      throw new Error(`Invalid workspace ID in registry record ${index + 1} at ${registry}`)
    }
    const rawState = state as Record<string, unknown>
    const presence = parseWorkspacePresence(typeof rawState.presence === "string" ? rawState.presence : undefined)
    if (!presence) {
      throw new Error(`Invalid workspace presence in registry record ${index + 1} at ${registry}`)
    }
    const rawRegistration = registration as Record<string, unknown>
    if (typeof rawRegistration.registeredAt !== "string" || !rawRegistration.registeredAt) {
      throw new Error(`Invalid registration date in registry record ${index + 1} at ${registry}`)
    }
    if (record.tags !== undefined && (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== "string"))) {
      throw new Error(`Invalid tags in registry record ${index + 1} at ${registry}`)
    }
    if (rawRegistration.lastSeenAt !== undefined && typeof rawRegistration.lastSeenAt !== "string") {
      throw new Error(`Invalid last-seen date in registry record ${index + 1} at ${registry}`)
    }
    return {
      path: record.path,
      name: record.name,
      ...(workspaceID ? { workspaceID } : {}),
      presence,
      setupStatus: parseSetupStatus(rawState.setupStatus),
      registeredAt: rawRegistration.registeredAt,
      ...(typeof rawRegistration.lastSeenAt === "string" ? { lastSeenAt: rawRegistration.lastSeenAt } : {}),
      tags: [...new Set((record.tags as string[] | undefined) ?? [])],
    }
  })
  return { schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION, workspaces }
}

async function readParsedRegistry(registry: string): Promise<WorkspaceRegistryDocument> {
  await chmod(registry, 0o600)
  return parseRegistryDocument(await readFile(registry, "utf8"), registry)
}

function persistedRegistryDocument(entries: WorkspaceRegistryEntry[]): Record<string, unknown> {
  return {
    schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION,
    workspaces: entries.map((entry) => ({
      ...(entry.workspaceID ? { id: entry.workspaceID } : {}),
      path: entry.path,
      name: entry.name,
      tags: entry.tags,
      state: {
        presence: entry.presence,
        setupStatus: entry.setupStatus,
      },
      registration: {
        registeredAt: entry.registeredAt,
        ...(entry.lastSeenAt ? { lastSeenAt: entry.lastSeenAt } : {}),
      },
    })),
  }
}

function serializeRegistryEntries(entries: WorkspaceRegistryEntry[]): string {
  return `${JSON.stringify(persistedRegistryDocument(entries), null, 2)}\n`
}

async function migrateLegacyRegistry(legacyRegistry: string): Promise<WorkspaceRegistryDocument> {
  const file = Bun.file(legacyRegistry)
  if (!(await file.exists())) return emptyRegistryDocument()
  await chmod(legacyRegistry, 0o600)
  const lines = (await file.text()).split(/\r?\n/).filter(Boolean)
  const workspaces: WorkspaceRegistryEntry[] = []
  for (const line of lines) {
    const decoded = decodeRegistryLine(line)
    if (!decoded) continue
    const meta = await readWorkspaceMeta(decoded.workspacePath).catch(() => undefined)
    const workspaceID = decoded.workspaceID ?? meta?.workspaceID ?? workspaceIDFromMarker(decoded.workspacePath)
    const presence = decoded.presence
      ?? (meta ? (workspaceID ? "present" : "legacy") : existsSync(decoded.workspacePath) ? "invalid" : "non_existent")
    workspaces.push({
      path: decoded.workspacePath,
      name: resolveWorkspaceDisplayName(decoded.workspacePath, decoded.project || meta?.projectName),
      ...(workspaceID ? { workspaceID } : {}),
      presence,
      setupStatus: meta?.setupStatus ?? "unknown",
      registeredAt: decoded.registered || new Date().toISOString().slice(0, 10),
      ...(presence === "present" || presence === "legacy" ? { lastSeenAt: new Date().toISOString() } : {}),
      tags: [],
    })
  }
  return { schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION, workspaces }
}

async function readRegistryDocument(registry: string, legacyRegistry?: string): Promise<WorkspaceRegistryDocument> {
  const file = Bun.file(registry)
  if (await file.exists()) {
    try {
      return await readParsedRegistry(registry)
    } catch (primaryError) {
      const backup = `${registry}.bak`
      const backupFile = Bun.file(backup)
      if (!(await backupFile.exists())) throw primaryError
      const recovered = await readParsedRegistry(backup)
      return withRegistryLock(async () => withRegistryFileLock(registry, async () => {
        try {
          return await readParsedRegistry(registry)
        } catch {
          await writeRegistryAtomically(registry, serializeRegistryEntries(recovered.workspaces), false)
          return recovered
        }
      }))
    }
  }
  if (!legacyRegistry || !(await Bun.file(legacyRegistry).exists())) return emptyRegistryDocument()

  return withRegistryLock(async () => withRegistryFileLock(registry, async () => {
    if (await Bun.file(registry).exists()) return readParsedRegistry(registry)
    const migrated = await migrateLegacyRegistry(legacyRegistry)
    await writeRegistryAtomically(registry, serializeRegistryEntries(migrated.workspaces))
    const backup = `${legacyRegistry}.migrated`
    if (!(await Bun.file(backup).exists())) {
      await rename(legacyRegistry, backup).catch(() => {})
      await chmod(backup, 0o600).catch(() => {})
    }
    return migrated
  }))
}

export async function ensureGlobalMetadata(): Promise<void> {
  const metadataDir = metadataPath()
  mkdirSync(metadataDir, { recursive: true, mode: 0o700 })
  chmodSync(metadataDir, 0o700)

  const configPath = path.join(metadataDir, "config.yaml")
  if (!existsSync(configPath)) {
    await writeYamlConfig(
      configPath,
      (document) => {
        document.set("beta", false)
        document.set("auto_upgrade", true)
      },
      "beta: false\nauto_upgrade: true\n",
    )
  }
  await chmod(configPath, 0o600)
}

export async function loadRegistry(
  configPath?: string,
  options?: { allowMissingMarker?: boolean },
): Promise<WorkspaceRegistryEntry[]> {
  const registry = configPath ?? metadataPath(WORKSPACE_REGISTRY_FILENAME)
  const isLegacyPath = path.extname(registry) === ".txt"
  const document = isLegacyPath
    ? await migrateLegacyRegistry(registry)
    : await readRegistryDocument(registry, configPath ? undefined : metadataPath(LEGACY_WORKSPACE_REGISTRY_FILENAME))
  const results: WorkspaceRegistryEntry[] = []
  const seen = new Set<string>()
  const pathsByID = new Map<SpinosaWorkspaceID, string>()
  const resultIndexByID = new Map<SpinosaWorkspaceID, number>()

  for (const entry of document.workspaces) {
    const workspacePath = entry.path
    if (!options?.allowMissingMarker && !validateWorkspace(workspacePath)) continue
    if (seen.has(workspacePath)) continue
    seen.add(workspacePath)
    const workspaceID = entry.workspaceID ?? workspaceIDFromMarker(workspacePath)
    const existingPath = workspaceID ? pathsByID.get(workspaceID) : undefined
    if (workspaceID && existingPath && existingPath !== workspacePath) {
      const existingLive = validateWorkspace(existingPath)
      const currentLive = validateWorkspace(workspacePath)
      if (existingLive && currentLive) {
        throw new Error(`Workspace ID ${workspaceID} maps to multiple live paths`)
      }
      if (!currentLive || existingLive) continue
      const index = resultIndexByID.get(workspaceID)
      if (index !== undefined) {
        results[index] = { ...entry, path: workspacePath, workspaceID }
        pathsByID.set(workspaceID, workspacePath)
        continue
      }
    }
    const result = { ...entry, ...(workspaceID ? { workspaceID } : {}) }
    if (workspaceID) {
      pathsByID.set(workspaceID, workspacePath)
      resultIndexByID.set(workspaceID, results.length)
    }
    results.push(result)
  }

  return results
}

export async function registerWorkspace(
  workspacePath: string,
  project: string,
  onRecover?: (msg: string) => void,
  workspaceID?: SpinosaWorkspaceID,
  options?: {
    presence?: SpinosaWorkspacePresence
    replacePath?: string
  },
): Promise<void> {
  await ensureGlobalMetadata()
  const registry = metadataPath(WORKSPACE_REGISTRY_FILENAME)
  await readRegistryDocument(registry, metadataPath(LEGACY_WORKSPACE_REGISTRY_FILENAME))
  const markerID = workspaceIDFromMarker(workspacePath)
  if (workspaceID && markerID !== workspaceID) {
    spinosaLogWarn("registry", `ID mismatch at ${workspacePath}: expected ${workspaceID}, marker has ${markerID} — skipping`)
    return
  }
  const canonicalID = workspaceID ?? (validateWorkspace(workspacePath) ? ensureWorkspaceID(workspacePath) : undefined)
  const meta = await readWorkspaceMeta(workspacePath).catch(() => undefined)

  return withRegistryLock(async () => {
    await withRegistryFileLock(registry, async () => {
      const file = Bun.file(registry)
      const document = await file.exists() ? await readParsedRegistry(registry) : emptyRegistryDocument()
      let inherited: WorkspaceRegistryEntry | undefined
      const filtered = document.workspaces.filter((entry) => {
        if (entry.path === workspacePath) {
          inherited ??= entry
          return false
        }
        const existingID = entry.workspaceID ?? workspaceIDFromMarker(entry.path)
        if (canonicalID && existingID === canonicalID) {
          if (validateWorkspace(entry.path)) {
            throw new Error(`Workspace ID ${canonicalID} is already registered at ${entry.path}`)
          }
          inherited ??= entry
          return false
        }
        if (options?.replacePath && entry.path === options.replacePath) {
          if (validateWorkspace(entry.path)) {
            throw new Error(`Cannot replace a live workspace registration at ${entry.path}`)
          }
          inherited ??= entry
          return false
        }
        return true
      })

      const presence = options?.presence
        ?? (meta ? (canonicalID ? "present" : "legacy") : inherited?.presence ?? "unknown")
      const now = new Date().toISOString()
      filtered.push({
        path: workspacePath,
        name: resolveWorkspaceDisplayName(workspacePath, project || meta?.projectName || inherited?.name),
        ...(canonicalID ? { workspaceID: canonicalID } : {}),
        presence,
        setupStatus: meta?.setupStatus ?? inherited?.setupStatus ?? "unknown",
        registeredAt: inherited?.registeredAt ?? now.slice(0, 10),
        ...(presence === "present" || presence === "legacy"
          ? { lastSeenAt: now }
          : inherited?.lastSeenAt ? { lastSeenAt: inherited.lastSeenAt } : {}),
        tags: inherited?.tags ?? [],
      })
      await writeRegistryAtomically(registry, serializeRegistryEntries(filtered))
    }, onRecover)
  })
}

export async function unregisterWorkspace(
  workspacePath: string,
  onRecover?: (msg: string) => void,
): Promise<void> {
  await ensureGlobalMetadata()
  const registry = metadataPath(WORKSPACE_REGISTRY_FILENAME)
  await readRegistryDocument(registry, metadataPath(LEGACY_WORKSPACE_REGISTRY_FILENAME))
  return withRegistryLock(async () => {
    await withRegistryFileLock(registry, async () => {
      const file = Bun.file(registry)
      if (!(await file.exists())) return

      const document = await readParsedRegistry(registry)
      const filtered = document.workspaces.filter((entry) => entry.path !== workspacePath)

      if (filtered.length < document.workspaces.length) {
        await writeRegistryAtomically(registry, serializeRegistryEntries(filtered))
      }
    }, onRecover)
  })
}

export async function setWorkspacePresence(input: {
  workspacePath: string
  workspaceID?: SpinosaWorkspaceID
  presence: SpinosaWorkspacePresence
  onRecover?: (msg: string) => void
}): Promise<void> {
  await ensureGlobalMetadata()
  const registry = metadataPath(WORKSPACE_REGISTRY_FILENAME)
  await readRegistryDocument(registry, metadataPath(LEGACY_WORKSPACE_REGISTRY_FILENAME))
  const meta = await readWorkspaceMeta(input.workspacePath).catch(() => undefined)
  return withRegistryLock(async () => {
    await withRegistryFileLock(registry, async () => {
      const file = Bun.file(registry)
      if (!(await file.exists())) return

      const document = await readParsedRegistry(registry)
      let changed = false
      const now = new Date().toISOString()
      const updated = document.workspaces.map((entry) => {
        const existingID = entry.workspaceID ?? workspaceIDFromMarker(entry.path)
        if (entry.path !== input.workspacePath && (!input.workspaceID || existingID !== input.workspaceID)) return entry
        changed = true
        return {
          ...entry,
          name: meta?.projectName ? resolveWorkspaceDisplayName(input.workspacePath, meta.projectName) : entry.name,
          ...(existingID ?? input.workspaceID ? { workspaceID: existingID ?? input.workspaceID } : {}),
          presence: input.presence,
          setupStatus: meta?.setupStatus ?? entry.setupStatus,
          ...(input.presence === "present" || input.presence === "legacy" ? { lastSeenAt: now } : {}),
        }
      })
      if (changed) await writeRegistryAtomically(registry, serializeRegistryEntries(updated))
    }, input.onRecover)
  })
}

export async function setWorkspaceTags(input: {
  workspacePath: string
  workspaceID?: SpinosaWorkspaceID
  tags: string[]
  onRecover?: (msg: string) => void
}): Promise<void> {
  await ensureGlobalMetadata()
  const registry = metadataPath(WORKSPACE_REGISTRY_FILENAME)
  await readRegistryDocument(registry, metadataPath(LEGACY_WORKSPACE_REGISTRY_FILENAME))
  const tags = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))]
  return withRegistryLock(async () => {
    await withRegistryFileLock(registry, async () => {
      const file = Bun.file(registry)
      if (!(await file.exists())) return
      const document = await readParsedRegistry(registry)
      let changed = false
      const updated = document.workspaces.map((entry) => {
        const existingID = entry.workspaceID ?? workspaceIDFromMarker(entry.path)
        if (entry.path !== input.workspacePath && (!input.workspaceID || existingID !== input.workspaceID)) return entry
        changed = true
        return { ...entry, ...(existingID ? { workspaceID: existingID } : {}), tags }
      })
      if (changed) await writeRegistryAtomically(registry, serializeRegistryEntries(updated))
    }, input.onRecover)
  })
}

export async function listRegisteredWorkspaces(): Promise<SpinosaRegisteredWorkspace[]> {
  const entries = await loadRegistry(undefined, { allowMissingMarker: true })
  await Promise.all(entries.filter((entry) =>
    validateWorkspace(entry.path)
    && (entry.presence === "present" || entry.presence === "legacy" || entry.presence === "unknown")
  ).map((entry) =>
    registerWorkspace(
      entry.path,
      resolveWorkspaceDisplayName(entry.path, entry.name),
      undefined,
      entry.workspaceID,
    ),
  ))
  const refreshed = await loadRegistry(undefined, { allowMissingMarker: true })
  return refreshed.map((entry) => ({
    path: entry.path,
    projectName: resolveWorkspaceDisplayName(entry.path, entry.name),
    ...(entry.workspaceID ? { workspaceID: entry.workspaceID } : {}),
    presence: entry.presence,
    setupStatus: entry.setupStatus,
    registeredAt: entry.registeredAt,
    tags: entry.tags,
  }))
}

export function validateWorkspace(path: string): boolean {
  if (!existsSync(path)) return false
  return existsSync(path + "/.spinosa/workspace")
    || existsSync(path + "/spinosa/workspace")
    || existsSync(path + "/framework/spinosa/workspace")
}

export function scanWorkspaces(roots: string[]): string[] {
  const seen = new Set<string>()
  const results: string[] = []

  for (const root of roots) {
    if (!existsSync(root)) continue
    walkWorkspaceMarker(root, 0, seen, results)
  }

  return results
}

function configuredSearchRoots(roots: string[] = []): string[] {
  const configured = process.env.SPINOSA_WORKSPACE_SEARCH_ROOTS?.split(path.delimiter).filter(Boolean) ?? []
  return [...new Set([...roots, ...configured].map((root) => path.resolve(root)).filter((root) => root !== path.parse(root).root))]
}

/** Finds canonical markers with this exact ID within explicit/configured roots only. */
export function findWorkspaceMatchesByID(workspaceID: SpinosaWorkspaceID, roots: string[] = []): string[] {
  const seen = new Set<string>()
  const results: string[] = []
  for (const root of configuredSearchRoots(roots)) walkWorkspaceIDMarker(root, 0, workspaceID, seen, results)
  return results
}

function walkWorkspaceIDMarker(dir: string, depth: number, workspaceID: SpinosaWorkspaceID, seen: Set<string>, results: string[]) {
  if (depth > 5 || seen.has(dir) || !existsSync(dir)) return
  seen.add(dir)
  if (workspaceIDFromMarker(dir) === workspaceID) results.push(dir)
  if (depth === 5) return
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        walkWorkspaceIDMarker(path.join(dir, entry.name), depth + 1, workspaceID, seen, results)
      }
    }
  } catch {}
}

/** Repairs a stale registry entry only when an ID has one unambiguous marker match. */
export async function recoverWorkspacePathByID(workspaceID: SpinosaWorkspaceID, roots: string[] = []): Promise<string | undefined> {
  const matches = findWorkspaceMatchesByID(workspaceID, roots)
  if (matches.length !== 1) return
  const workspacePath = matches[0]
  await registerWorkspace(workspacePath, resolveWorkspaceDisplayName(workspacePath), undefined, workspaceID)
  return workspacePath
}

function walkWorkspaceMarker(dir: string, depth: number, seen: Set<string>, results: string[]) {
  if (depth > 5) return
  if (seen.has(dir)) return
  seen.add(dir)

  const marker = path.join(dir, ".spinosa", "workspace")
  if (existsSync(marker)) {
    results.push(dir)
    return
  }

  if (depth === 5) return

  let entries: string[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => path.join(dir, e.name))
  } catch {
    return
  }

  for (const entry of entries) {
    walkWorkspaceMarker(entry, depth + 1, seen, results)
  }
}

export async function discoverRegisteredWorkspaces(): Promise<string[]> {
  await ensureGlobalMetadata()

  const entries = await loadRegistry(undefined, { allowMissingMarker: true })
  if (entries.length > 0) return entries.map((entry) => entry.path)

  const cachePath = metadataPath("workspace_cache.txt")
  const cacheFile = Bun.file(cachePath)
  if (await cacheFile.exists()) {
    await chmod(cachePath, 0o600)
    const text = await cacheFile.text()
    const lines = text.split(/\r?\n/).filter(Boolean)
    return lines
      .map((line) => line.split("|")[0] ?? "")
      .filter(Boolean)
      .map(registryUnescape)
  }

  return []
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function writeSetupFiles(
  root: string,
  projectTitle: string,
  sourcePath: string,
  preferredCli: string,
): Promise<void> {
  const contextPath = path.join(root, "system", "context.md")
  const configPath = path.join(root, "system", "configuration.md")
  const agentsPath = path.join(root, "AGENTS.md")
  const claudePath = path.join(root, "CLAUDE.md")

  const date = today()

  const contextContent = `---
type: information
agent: setup_cli
description:
  - Project blueprint filled during onboarding and startup.
  - Agents read this to understand scope, active corpus, evidence rules, and researcher preferences.
created: ${date}
updated: ${date}
connects_to:
  - AGENTS.md
  - system/configuration.md
  - startup-prompt.md
  - .logs/user_requests.md
---

# Information

## Project
- Title: ${projectTitle || "[project name]"}
- Description: not provided during fast setup; infer from the raw corpus during startup

## Project Artifacts
- none provided during fast setup

## Sources
- Active corpus: raw/
- Main source types: [inferred during startup from the raw corpus]
- Expected incoming sources: [inferred during startup]

## Research Vocabulary
- Key actors / institutions / places: [inferred during startup]
- Key concepts: [inferred during startup]
- Sensitizing concepts, not evidence: [inferred during startup]
- Theoretical frames, not forced labels: [inferred during startup]

## Method And Evidence
- Methods: [inferred during startup]
- Claims require source paths.
- L2 clues require Verifier checking before reporting.
- External sources must stay labeled external unless moved into \`raw/\`.
- External source policy: no (default; ask only if external access is needed)

## Outputs
- Start with navigation maps in maps/ and evidence-grounded answers unless the researcher requests another output.

## Blind Spots
- [identified during startup]

## Researcher Preferences
[stated or inferred during startup]

## Preferred LLM CLI
${preferredCli}
`

  const configContent = `---
type: project_configuration
agent: setup_cli
description:
  - Operating profile for the current Spinosa project or framework template.
  - Agents read this first to learn source policy, protected paths, and setup status.
created: ${date}
updated: ${date}
setup_status: cli_started
---

# Configuration

Agents read this before major work.

\`\`\`yaml
workspace_type: research_framework
research_mode: evolving_complex_corpus
active_corpus_path: raw/
source_mode: imported_raw_corpus

source_policy: internal_first
active_corpus_policy: raw_only_after_onboarding
external_sources_allowed: no

claim_standard: source_link_required
l2_policy: verifier_required

protected_paths:
  - raw/
  - context.md

stale_after_days: 30
preferred_llm_cli: "${preferredCli}"
\`\`\`

## Notes
- This file was initialized by \`spinosa new\`.
- The CLI collected: source folder and preferred LLM CLI. It seeded the initial workspace label from the source folder name. It imported accepted files into raw/. Office documents, structured data, and text-based PDFs were converted to Markdown. Scanned PDFs were processed via Tesseract (ita+eng+fra 300dpi); images via vision LLM when selected, otherwise copied. Selected audio and video files were copied unchanged. AGENTS.md control files were skipped.
- After onboarding, normal source-grounded work starts from raw/.
- During startup, project description and helpful artifact URLs are optional. If absent, the LLM CLI agent records them as not provided, keeps external_sources_allowed at its default \`no\`, and infers working scope from the raw corpus.
- When setup_status reaches workspace_started, the startup workflow has built the master dictionary, generated YAML headers, created multi-level navigation maps in maps/, and passed validation.
- This file never grants permission to edit \`raw/\`.
`

  await Bun.write(contextPath, contextContent)
  await Bun.write(configPath, configContent)

  if (preferredCli === "Claude Code" && existsSync(agentsPath)) {
    await Bun.write(claudePath, Bun.file(agentsPath))
  }
}
