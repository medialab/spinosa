// This file provides a SpinosaHarness implementation for tests.
// The mock adapter stores sessions and events in memory.
// It does not connect to a real kernel.
// Use this implementation in unit tests and contract tests.

import type {
  AgentExecutionResult,
  CreateHarnessSessionInput,
  HarnessEvent,
  HarnessSession,
  HarnessToolRule,
  PermissionReply,
  SpinosaHarness,
} from "./contract"

// An in-memory SpinosaHarness for testing.
// Sessions are stored in a Map.
// Events are stored in an array.
// The sequence counter generates unique identifiers.
//
// WP4 extensions (same contract as kernel adapter):
// - scriptedOutputs: per-agent canned text (executionText parity)
// - failures: per-agent errors to throw on executeAgent
// - delaysMs: per-agent artificial latency (parallel tests)
// - toolPolicy capture + child-session metadata on createSession
// - cancellation state per session
export class MockHarness implements SpinosaHarness {
  readonly capabilities = {
    directToolExecution: true,
    permissions: true,
    cancellation: true,
    childSessions: true,
    parallelAgentExecutions: true,
    scopedSessionPermissions: true,
  }
  readonly events: HarnessEvent[] = []
  readonly executions: Array<{
    sessionID: string
    agent: string
    prompt: string
    system?: string
    synthetic?: boolean
    silent?: boolean
    model?: { providerID: string; modelID: string }
  }> = []
  readonly sessions = new Map<string, HarnessSession>()
  readonly sessionMeta = new Map<string, { parentSessionID?: string; agent?: string; toolPolicy?: readonly HarnessToolRule[]; metadata?: Record<string, unknown> }>()
  readonly cancelled = new Set<string>()
  scriptedOutputs = new Map<string, string>()
  failures = new Map<string, Error>()
  delaysMs = new Map<string, number>()
  private sequence = 0

  // Create a new session with a mock identifier.
  // Records parentSessionID / toolPolicy / metadata for parity assertions.
  async createSession(input: CreateHarnessSessionInput): Promise<HarnessSession> {
    const session = { id: "mock-" + ++this.sequence, workspacePath: input.workspacePath, title: input.title }
    this.sessions.set(session.id, session)
    this.sessionMeta.set(session.id, {
      parentSessionID: input.parentSessionID,
      agent: input.agent,
      toolPolicy: input.toolPolicy,
      metadata: input.metadata,
    })
    this.events.push({ type: "session.created", sessionID: session.id })
    return session
  }

  // Start a mock agent execution. Honors failures/delays/scriptedOutputs.
  async executeAgent(input: {
    sessionID: string
    agent: string
    prompt: string
    system?: string
    synthetic?: boolean
    silent?: boolean
    model?: { providerID: string; modelID: string }
  }): Promise<AgentExecutionResult> {
    const delay = this.delaysMs.get(input.agent) ?? this.delaysMs.get("*") ?? 0
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    if (this.cancelled.has(input.sessionID)) throw new Error(`MockHarness execution cancelled for ${input.sessionID}`)
    const failure = this.failures.get(input.agent)
    if (failure) throw failure
    const executionID = "execution-" + ++this.sequence
    this.executions.push(input)
    this.events.push({ type: "agent.started", sessionID: input.sessionID, executionID, detail: input.agent })
    const text = this.scriptedOutputs.get(input.agent) ?? this.scriptedOutputs.get("*") ?? `mock output for ${input.agent}`
    return { executionID, sessionID: input.sessionID, assistantMessageID: "msg-" + this.sequence, text }
  }

  // Execute a mock tool.
  // The method creates a tool.completed event and returns the input arguments as output.
  async executeTool(input: { sessionID: string; tool: string; arguments: Record<string, unknown> }): Promise<{ output: unknown }> {
    this.events.push({ type: "tool.completed", sessionID: input.sessionID, detail: input.tool, payload: input.arguments })
    return { output: input.arguments }
  }

  // Get a stream of stored events for a session.
  // The method filters events by session identifier and optional execution identifier.
  async *streamEvents(input: { sessionID: string; executionID?: string }): AsyncIterable<HarnessEvent> {
    for (const event of this.events) {
      if (event.sessionID === input.sessionID && (!input.executionID || event.executionID === input.executionID)) yield event
    }
  }

  // Reply to a permission request.
  // The method pushes a permission.replied event to the event list.
  async replyPermission(input: { requestID: string; reply: PermissionReply }): Promise<void> {
    this.events.push({ type: "permission.replied", detail: input.requestID + ":" + input.reply })
  }

  // Cancel a mock execution. Records cancellation so the next executeAgent rejects.
  async cancelExecution(input: { sessionID: string; executionID?: string }): Promise<void> {
    this.cancelled.add(input.sessionID)
    this.events.push({ type: "execution.cancelled", sessionID: input.sessionID, executionID: input.executionID })
  }

  // Read a session from the sessions map.
  // Returns undefined when the session does not exist.
  async readSession(input: { sessionID: string }): Promise<HarnessSession | undefined> {
    return this.sessions.get(input.sessionID)
  }
}
