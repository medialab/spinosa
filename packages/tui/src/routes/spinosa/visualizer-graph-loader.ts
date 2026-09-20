import path from "node:path";
import type { FileNode, Part, ToolPart } from "@spinosa/sdk/v2";
import type { WorkspaceFile } from "./visualizer-graph-data";
import type { ToolCallRecord } from "./visualizer-types";

export const TOOL_CALL_PAGE_SIZE = 200;
const VISUALIZER_LOAD_CONCURRENCY = 8;
export const DEFAULT_HEAVY_DIRECTORIES = [
  ".bun",
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".pnpm-store",
  ".svelte-kit",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
  "venv",
] as const;

export type VisualizerSession = {
  id: string;
  title: string;
  parentID?: string;
};

export type VisualizerSessionMessage = {
  info: {
    id: string;
    sessionID: string;
    time: { created: number };
  };
  parts: Part[];
};

export type VisualizerSDKResponse<T> = {
  data?: T;
  error?: unknown;
  response: { headers: { get(name: string): string | null } };
};

export interface VisualizerGraphClient {
  session: {
    messages(input: {
      sessionID: string;
      directory?: string;
      limit: number;
      before?: string;
    }): Promise<VisualizerSDKResponse<VisualizerSessionMessage[]>>;
    children(input: {
      sessionID: string;
      directory?: string;
    }): Promise<VisualizerSDKResponse<VisualizerSession[]>>;
  };
  file: {
    list(input: {
      path: string;
      directory?: string;
    }): Promise<VisualizerSDKResponse<FileNode[]>>;
  };
}

export type PagedToolCallCoverage = {
  sessionID: string;
  pagesLoaded: number;
  cursorsFollowed: number;
  messagesLoaded: number;
  toolCallsLoaded: number;
};

export type SessionClosureCoverage = {
  requestedRoots: number;
  sessionsDiscovered: number;
  sessionsExpanded: number;
  levelsLoaded: number;
};

export type SessionTreeCoverage = {
  rootSessionID: string;
  sessionsDiscovered: number;
  sessionsLoaded: number;
  pagesLoaded: number;
  messagesLoaded: number;
  toolCallsLoaded: number;
  failedSessionID?: string;
};

export type WorkspaceFileCoverage = {
  directoriesVisited: number;
  filesFound: number;
  ignoredEntries: number;
  heavyDirectoriesSkipped: number;
  unsafeEntries: number;
  nonFileEntries: number;
};

export type VisualizerGraphLoadCoverage =
  | PagedToolCallCoverage
  | SessionClosureCoverage
  | SessionTreeCoverage
  | WorkspaceFileCoverage;
export type VisualizerGraphLoadStage = "messages" | "sessions" | "files";

export class VisualizerGraphLoadError extends Error {
  override readonly name = "VisualizerGraphLoadError";

  constructor(
    readonly stage: VisualizerGraphLoadStage,
    message: string,
    readonly coverage: VisualizerGraphLoadCoverage,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export type PagedToolCallLoad = {
  toolCalls: ToolCallRecord[];
  coverage: PagedToolCallCoverage;
};

export type SessionClosureLoad = {
  sessions: VisualizerSession[];
  coverage: SessionClosureCoverage;
};

export type SessionTreeLoad = {
  sessions: VisualizerSession[];
  toolCalls: ToolCallRecord[];
  coverage: SessionTreeCoverage;
};

export type WorkspaceFileLoad = {
  files: WorkspaceFile[];
  coverage: WorkspaceFileCoverage;
};

export async function loadPagedSessionToolCalls(
  client: Pick<VisualizerGraphClient, "session">,
  session: VisualizerSession,
  options: { directory?: string } = {},
): Promise<PagedToolCallLoad> {
  const coverage: PagedToolCallCoverage = {
    sessionID: session.id,
    pagesLoaded: 0,
    cursorsFollowed: 0,
    messagesLoaded: 0,
    toolCallsLoaded: 0,
  };
  const cursors = new Set<string>();
  const loaded: Array<{
    record: ToolCallRecord;
    messageTime: number;
    partIndex: number;
  }> = [];
  let before: string | undefined;

  while (true) {
    const result = await sdkRequest("messages", coverage, () =>
      client.session.messages({
        sessionID: session.id,
        directory: options.directory,
        limit: TOOL_CALL_PAGE_SIZE,
        before,
      }),
    );
    const messages = requireArray(
      result.data,
      "messages",
      coverage,
      "session messages",
    );
    coverage.pagesLoaded++;
    coverage.messagesLoaded += messages.length;

    for (const message of messages) {
      if (!isSessionMessage(message)) {
        throw loadError(
          "messages",
          "Session messages returned an invalid entry",
          coverage,
        );
      }
      for (let partIndex = 0; partIndex < message.parts.length; partIndex++) {
        const part = message.parts[partIndex];
        if (part?.type !== "tool") continue;
        loaded.push({
          record: toToolCallRecord(part, message.info.time.created, session),
          messageTime: message.info.time.created,
          partIndex,
        });
        coverage.toolCallsLoaded++;
      }
    }

    const next = result.response.headers.get("X-Next-Cursor")?.trim();
    if (!next) break;
    if (cursors.has(next)) {
      throw loadError(
        "messages",
        `Session messages repeated pagination cursor ${next}`,
        coverage,
      );
    }
    cursors.add(next);
    coverage.cursorsFollowed++;
    before = next;
  }

  loaded.sort(
    (a, b) =>
      a.record.timeStart - b.record.timeStart ||
      a.messageTime - b.messageTime ||
      a.record.messageID!.localeCompare(b.record.messageID!) ||
      a.partIndex - b.partIndex ||
      a.record.id.localeCompare(b.record.id),
  );
  return {
    toolCalls: loaded.map((item) => item.record),
    coverage: { ...coverage },
  };
}

export async function loadSessionClosure(
  client: Pick<VisualizerGraphClient, "session">,
  roots: readonly VisualizerSession[],
  options: { directory?: string } = {},
): Promise<SessionClosureLoad> {
  const coverage: SessionClosureCoverage = {
    requestedRoots: roots.length,
    sessionsDiscovered: 0,
    sessionsExpanded: 0,
    levelsLoaded: 0,
  };
  const sessions: VisualizerSession[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!isSession(root))
      throw loadError(
        "sessions",
        "Session closure received an invalid root",
        coverage,
      );
    if (seen.has(root.id)) continue;
    seen.add(root.id);
    sessions.push(root);
  }
  coverage.sessionsDiscovered = sessions.length;

  let frontier = [...sessions];
  while (frontier.length > 0) {
    coverage.levelsLoaded++;
    const responses = await mapWithConcurrency(frontier, VISUALIZER_LOAD_CONCURRENCY, async (parent) => {
      const result = await sdkRequest("sessions", coverage, () =>
        client.session.children({
          sessionID: parent.id,
          directory: options.directory,
        }),
      );
      const children = requireArray(
        result.data,
        "sessions",
        coverage,
        `children for session ${parent.id}`,
      );
      coverage.sessionsExpanded++;
      return { parent, children };
    });

    const next: VisualizerSession[] = [];
    for (const { parent, children } of responses) {
      for (const child of children) {
        if (!isSession(child)) {
          throw loadError(
            "sessions",
            `Session ${parent.id} returned an invalid child`,
            coverage,
          );
        }
        if (seen.has(child.id)) continue;
        const linked = child.parentID
          ? child
          : { ...child, parentID: parent.id };
        seen.add(linked.id);
        sessions.push(linked);
        next.push(linked);
      }
    }
    coverage.sessionsDiscovered = sessions.length;
    frontier = next;
  }

  return { sessions, coverage: { ...coverage } };
}

export async function loadSelectedSessionTree(
  client: Pick<VisualizerGraphClient, "session">,
  root: VisualizerSession,
  options: { directory?: string } = {},
): Promise<SessionTreeLoad> {
  const closure = await loadSessionClosure(client, [root], options);
  const coverage: SessionTreeCoverage = {
    rootSessionID: root.id,
    sessionsDiscovered: closure.sessions.length,
    sessionsLoaded: 0,
    pagesLoaded: 0,
    messagesLoaded: 0,
    toolCallsLoaded: 0,
  };
  const settled = await mapWithConcurrency(closure.sessions, VISUALIZER_LOAD_CONCURRENCY, async (session) => {
    try {
      const value = await loadPagedSessionToolCalls(client, session, options);
      return { status: "fulfilled" as const, value };
    } catch (reason) {
      return { status: "rejected" as const, reason };
    }
  });
  const toolCalls: ToolCallRecord[] = [];
  let failure: { sessionID: string; cause: unknown } | undefined;

  for (let index = 0; index < settled.length; index++) {
    const result = settled[index]!;
    const session = closure.sessions[index]!;
    if (result.status === "rejected") {
      failure ??= { sessionID: session.id, cause: result.reason };
      const partial = pagedCoverage(result.reason);
      if (partial) {
        coverage.pagesLoaded += partial.pagesLoaded;
        coverage.messagesLoaded += partial.messagesLoaded;
        coverage.toolCallsLoaded += partial.toolCallsLoaded;
      }
      continue;
    }
    coverage.sessionsLoaded++;
    coverage.pagesLoaded += result.value.coverage.pagesLoaded;
    coverage.messagesLoaded += result.value.coverage.messagesLoaded;
    coverage.toolCallsLoaded += result.value.coverage.toolCallsLoaded;
    toolCalls.push(...result.value.toolCalls);
  }

  if (failure) {
    coverage.failedSessionID = failure.sessionID;
    const cause = failure.cause;
    throw loadError(
      cause instanceof VisualizerGraphLoadError ? cause.stage : "messages",
      `Failed to load selected session tree at ${failure.sessionID}`,
      coverage,
      cause,
    );
  }

  toolCalls.sort(
    (a, b) =>
      a.timeStart - b.timeStart ||
      (a.sessionID ?? "").localeCompare(b.sessionID ?? "") ||
      a.id.localeCompare(b.id),
  );
  return { sessions: closure.sessions, toolCalls, coverage: { ...coverage } };
}

export async function loadWorkspaceFileInventory(
  client: Pick<VisualizerGraphClient, "file">,
  workspaceRoot: string,
  options: { heavyDirectories?: readonly string[] } = {},
): Promise<WorkspaceFileLoad> {
  const coverage: WorkspaceFileCoverage = {
    directoriesVisited: 0,
    filesFound: 0,
    ignoredEntries: 0,
    heavyDirectoriesSkipped: 0,
    unsafeEntries: 0,
    nonFileEntries: 0,
  };
  const root = path.resolve(workspaceRoot);
  const heavy = new Set(options.heavyDirectories ?? DEFAULT_HEAVY_DIRECTORIES);
  const directories = ["."];
  const queued = new Set(directories);
  const files = new Map<string, WorkspaceFile>();

  while (directories.length > 0) {
    const directory = directories.shift()!;
    const result = await sdkRequest("files", coverage, () =>
      client.file.list({ path: directory, directory: root }),
    );
    const entries = requireArray(
      result.data,
      "files",
      coverage,
      `entries for ${directory}`,
    );
    coverage.directoriesVisited++;

    for (const entry of entries) {
      const safe = safeWorkspaceEntry(root, directory, entry);
      if (!safe) {
        coverage.unsafeEntries++;
        continue;
      }
      if (entry.ignored) {
        coverage.ignoredEntries++;
        continue;
      }
      if (entry.type === "directory") {
        if (heavy.has(path.posix.basename(safe.path))) {
          coverage.heavyDirectoriesSkipped++;
          continue;
        }
        if (!queued.has(safe.path)) {
          queued.add(safe.path);
          directories.push(safe.path);
        }
        continue;
      }
      if (entry.type !== "file") {
        coverage.nonFileEntries++;
        continue;
      }
      files.set(safe.path, safe);
      coverage.filesFound = files.size;
    }
  }

  const inventory = [...files.values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  return { files: inventory, coverage: { ...coverage } };
}

function toToolCallRecord(
  part: ToolPart,
  messageTime: number,
  session: VisualizerSession,
): ToolCallRecord {
  const state = part.state;
  const metadata = "metadata" in state ? state.metadata : part.metadata;
  return {
    id: part.id,
    callID: part.callID,
    messageID: part.messageID,
    sessionID: part.sessionID,
    parentSessionID: session.parentID,
    tool: part.tool,
    status: state.status,
    input: state.input,
    output: state.status === "completed" ? state.output : undefined,
    error: state.status === "error" ? state.error : undefined,
    title: "title" in state ? state.title : undefined,
    metadata,
    timeStart: state.status === "pending" ? messageTime : state.time.start,
    timeEnd:
      state.status === "completed" || state.status === "error"
        ? state.time.end
        : undefined,
    sessionTitle: session.title,
    part,
  };
}

async function sdkRequest<T, C extends VisualizerGraphLoadCoverage>(
  stage: VisualizerGraphLoadStage,
  coverage: C,
  request: () => Promise<VisualizerSDKResponse<T>>,
): Promise<VisualizerSDKResponse<T>> {
  let result: VisualizerSDKResponse<T>;
  try {
    result = await request();
  } catch (cause) {
    throw loadError(
      stage,
      `Failed to load visualizer ${stage}`,
      coverage,
      cause,
    );
  }
  if (result.error !== undefined) {
    throw loadError(
      stage,
      `Failed to load visualizer ${stage}: ${errorText(result.error)}`,
      coverage,
      result.error,
    );
  }
  return result;
}

function requireArray<T, C extends VisualizerGraphLoadCoverage>(
  value: T[] | undefined,
  stage: VisualizerGraphLoadStage,
  coverage: C,
  label: string,
): T[] {
  if (Array.isArray(value)) return value;
  throw loadError(stage, `SDK returned no ${label}`, coverage);
}

function isSessionMessage(value: VisualizerSessionMessage): boolean {
  return (
    !!value &&
    !!value.info &&
    typeof value.info.id === "string" &&
    typeof value.info.sessionID === "string" &&
    typeof value.info.time?.created === "number" &&
    Array.isArray(value.parts)
  );
}

function isSession(value: VisualizerSession): boolean {
  return (
    !!value &&
    typeof value.id === "string" &&
    !!value.id &&
    typeof value.title === "string"
  );
}

function pagedCoverage(error: unknown): PagedToolCallCoverage | undefined {
  if (
    !(error instanceof VisualizerGraphLoadError) ||
    error.stage !== "messages"
  )
    return;
  const coverage = error.coverage;
  return "sessionID" in coverage ? coverage : undefined;
}

function safeWorkspaceEntry(
  root: string,
  directory: string,
  entry: FileNode,
): WorkspaceFile | undefined {
  if (
    !entry ||
    typeof entry.path !== "string" ||
    typeof entry.absolute !== "string"
  )
    return;
  const raw = entry.path.trim().replaceAll("\\", "/");
  if (
    !raw ||
    raw.includes("\0") ||
    path.posix.isAbsolute(raw) ||
    /^[A-Za-z]:\//.test(raw)
  )
    return;
  const relative = path.posix
    .normalize(raw)
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  if (
    !relative ||
    relative === "." ||
    relative === ".." ||
    relative.startsWith("../")
  )
    return;

  const parent = path.posix.dirname(relative);
  const expectedParent = directory === "." ? "." : directory;
  if (parent !== expectedParent) return;

  const absolute = path.resolve(root, relative);
  const fromRoot = path.relative(root, absolute);
  if (
    !fromRoot ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(fromRoot)
  )
    return;
  if (path.resolve(entry.absolute) !== absolute) return;
  return { path: relative, absolute };
}

function loadError<C extends VisualizerGraphLoadCoverage>(
  stage: VisualizerGraphLoadStage,
  message: string,
  coverage: C,
  cause?: unknown,
): VisualizerGraphLoadError {
  return new VisualizerGraphLoadError(
    stage,
    message,
    { ...coverage },
    { cause },
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "SDK request failed";
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        out[index] = await fn(items[index]!);
      }
    }),
  );
  return out;
}
