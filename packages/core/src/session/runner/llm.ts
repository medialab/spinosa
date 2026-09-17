import {
  LLM,
  LLMClient,
  LLMError,
  LLMEvent,
  Message,
  SystemPart,
  isContextOverflowFailure,
  type ProviderErrorEvent,
} from "@spinosa/llm"
import { Cause, DateTime, Effect, FiberSet, Layer, Option, Semaphore, Stream } from "effect"
import { AgentV2 } from "../../agent"
import { Permission } from "@spinosa/schema/permission"
import { PermissionV2 } from "../../permission"
import { Config } from "../../config"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { SystemContext } from "../../system-context/index"
import { SystemContextRegistry } from "../../system-context/registry"
import { SkillGuidance } from "../../skill/guidance"
import { ReferenceGuidance } from "../../reference/guidance"
import { ToolRegistry } from "../../tool/registry"
import { ToolOutputStore } from "../../tool-output-store"
import { SessionContextEpoch } from "../context-epoch"
import { SessionCompaction } from "../compaction"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionInput } from "../input"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { type RunError, Service } from "./index"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import { SessionLoopControl } from "../loop-control"

const DOOM_LOOP_THRESHOLD = 3
const DOOM_LOOP_ACTION = "doom_loop"

const serializeToolInput = (input: unknown): string => {
  try {
    const serialized = JSON.stringify(input)
    return serialized ?? String(input)
  } catch {
    return String(input)
  }
}

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [ ] Mark busy, retrying, idle, interrupted, or terminal-failure status durably.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Honor optional agent step limits.
 *   - [x] Bound repeated identical tool calls via doom_loop guard (3 identical consecutive).
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@spinosa/llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [x] Stream exactly one `llm.stream(request)` provider turn.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute recorded local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [x] Continue for durable user steering accepted during an active provider turn.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here.
 * Durable continuation recovery remains a separate future slice with an explicit retry policy.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and an
 * explicit loop starts the next provider turn after local settlement. Configured agent step limits bound the loop.
 */

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const systemContext = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const config = yield* Config.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const compaction = SessionCompaction.make({ events, llm, config: yield* config.entries() })
    const permission = yield* PermissionV2.Service
    // Doom-loop guard: per-session sliding window of last 3 tool calls.
    // Mirrors spinosa-kernel processor.ts DOOM_LOOP_THRESHOLD=3 permission.ask("doom_loop").
    const doomLoopHistory = new Map<string, Array<{ name: string; serialized: string }>>()
    // Default Pi-style turn hooks; keep the surface callable/overridable but minimal.
    const hooks = SessionLoopControl.resolveTurnHooks()
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })
    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* getContext(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "unknown", message: "Tool execution interrupted" },
            provider: {
              executed: tool.provider?.executed === true,
              ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
            },
          })
        }
      }
    })

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

    // Match V1: dismissing a question halts the loop instead of becoming model-facing tool output.
    const isQuestionRejected = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect instanceof QuestionV2.RejectedError)

    type TurnTransition =
      // Automatic compaction completed; rebuild the request from compacted history.
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number }
      // Overflow compaction completed; rebuild once through the path without overflow recovery.
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number }

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number) => new TurnTransitionError({ _tag: "ContinueAfterCompaction", step })
    const continueAfterOverflowCompaction = (step: number) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step })

    const loadSystemContext = (agent: AgentV2.Selection) =>
      Effect.all([systemContext.load(), skillGuidance.load(agent), referenceGuidance.load()], {
        concurrency: "unbounded",
      }).pipe(Effect.map(SystemContext.combine))

    type TurnResult = {
      readonly needsContinuation: boolean
      readonly terminated: boolean
      readonly maxStepsReached: boolean
      readonly step: number
      readonly snapshot: SessionLoopControl.TurnSnapshot
    }

    const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      savePoints: Map<string, SessionLoopControl.SavePoint>,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
    ) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(agent), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      let needsContinuation = false
      let currentStep = step
      if (promotion) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        let promoted = 0
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        }
        if (promoted > 0) currentStep = 1
      }
      const system =
        initialized ?? (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.id))
      const model = yield* models.resolve(session)
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
      const context = entries.map((entry) => entry.message)
      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      const sessionPermission = (session as SessionSchema.Info & { permission?: Permission.Ruleset }).permission
      const mergedPermissions = sessionPermission
        ? [...(agent.info?.permissions ?? []), ...sessionPermission]
        : agent.info?.permissions
      const toolMaterialization = isLastStep ? undefined : yield* tools.materialize(mergedPermissions)
      const systemParts = [agent.info?.system, system.baseline].filter(
        (part): part is string => part !== undefined && part.length > 0,
      )
      // Freeze tools/system/model for this turn — mid-run setters apply after save-point refresh.
      const turnSnapshot = SessionLoopControl.freezeTurn({
        sessionID: session.id,
        step: currentStep,
        promotion,
        system: systemParts,
        toolNames: (toolMaterialization?.definitions ?? []).map((definition) => definition.name),
        model: {
          id: model.id,
          provider: model.provider,
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
      })
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const request = LLM.request({
        model,
        providerOptions: { openai: { promptCacheKey } },
        system: turnSnapshot.system.map(SystemPart.make),
        messages: [...toLLMMessages(context, model), ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : [])],
        tools: toolMaterialization?.definitions ?? [],
        toolChoice: isLastStep ? "none" : undefined,
      })
      // prepareNextTurn: auto-compaction / overflow decision before the provider call.
      const wouldCompact = yield* compaction.compactIfNeeded({ sessionID: session.id, entries, model, request })
      const prepare = hooks.prepareNextTurn({ snapshot: turnSnapshot, wouldCompact })
      if (prepare.action === "stop") {
        return {
          needsContinuation: false,
          terminated: true,
          maxStepsReached: isLastStep,
          step: currentStep,
          snapshot: turnSnapshot,
        } satisfies TurnResult
      }
      if (prepare.action === "compact") {
        // Refresh save-point before compaction restart so the next turn sees live barriers.
        savePoints.set(
          session.id,
          SessionLoopControl.refreshSavePoint({
            snapshot: turnSnapshot,
            previous: savePoints.get(session.id),
          }),
        )
        return yield* Effect.die(continueAfterCompaction(currentStep))
      }
      const startSnapshot = yield* snapshots.capture()
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        model: {
          id: ModelV2.ID.make(turnSnapshot.model.id),
          providerID: ProviderV2.ID.make(turnSnapshot.model.provider),
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
        snapshot: startSnapshot,
      })
      const withPublication = Semaphore.makeUnsafe(1).withPermit
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
        withPublication(publisher.publish(event, outputPaths))
      let overflowFailure: ProviderErrorEvent | undefined
      let terminateAfterTools = false
      const providerStream = llm.stream(request).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (overflowFailure || publisher.hasProviderError()) return
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                overflowFailure = event
                return
              }
            }
            yield* publish(event)
            if (event.type !== "tool-call" || event.providerExecuted) return
            if (!toolMaterialization) {
              yield* withPublication(publisher.failUnsettledTools("Tools are disabled after the maximum agent steps"))
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            // doom_loop guard: 3 identical consecutive tool calls (name + stringified input)
            // Mirrors spinosa-kernel/src/session/processor.ts:356 DOOM_LOOP_THRESHOLD=3
            {
              const serialized = serializeToolInput(event.input)
              const key = session.id as string
              const history: Array<{ name: string; serialized: string }> =
                doomLoopHistory.get(key) ?? ([] as Array<{ name: string; serialized: string }>)
              history.push({ name: event.name, serialized })
              if (history.length > DOOM_LOOP_THRESHOLD) history.shift()
              doomLoopHistory.set(key, history)
              const isDoomLoop =
                history.length === DOOM_LOOP_THRESHOLD &&
                history.every((entry) => entry.name === event.name && entry.serialized === serialized)
              if (isDoomLoop) {
                const doomResult = yield* permission
                  .assert({
                    action: DOOM_LOOP_ACTION,
                    resources: [event.name],
                    save: [event.name],
                    sessionID: session.id,
                    agent: agent.id,
                    source: { type: "tool", messageID: assistantMessageID, callID: event.id },
                    metadata: { tool: event.name, input: event.input },
                  })
                  .pipe(
                    Effect.map(() => ({ blocked: false as const })),
                    Effect.catch((error: unknown) =>
                      Effect.gen(function* () {
                        const message =
                          error instanceof PermissionV2.CorrectedError
                            ? error.feedback
                            : error instanceof PermissionV2.DeniedError
                              ? `Permission denied for ${DOOM_LOOP_ACTION}:${event.name}`
                              : error instanceof PermissionV2.RejectedError
                                ? "Doom loop rejected"
                                : error instanceof Error
                                  ? error.message
                                  : String(error)
                        yield* publish(
                          LLMEvent.toolResult({
                            id: event.id,
                            name: event.name,
                            result: {
                              type: "error",
                              value: `Doom loop detected: 3 identical ${event.name} calls blocked. ${message}`,
                            },
                          }),
                        )
                        needsContinuation = false
                        terminateAfterTools = true
                        doomLoopHistory.set(key, [])
                        return { blocked: true as const }
                      }),
                    ),
                  )
                if (doomResult.blocked) return
                // Allowed — reset window so next identical burst requires 3 more.
                doomLoopHistory.set(key, [])
              }
            }
            // beforeToolCall gate: skip/deny without entering Permission.ask.
            const gate = hooks.beforeToolCall({ toolName: event.name, callID: event.id })
            if (gate.action === "skip") {
              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: {
                    type: "error",
                    value: gate.reason ?? `Tool call skipped: ${event.name}`,
                  },
                }),
              )
              return
            }
            const controller = new AbortController()
            yield* Effect.uninterruptibleMask((restore) =>
              restore(
                toolMaterialization
                  .settle({
                    sessionID: session.id,
                    agent: agent.id,
                    assistantMessageID,
                    call: event,
                    abort: controller.signal,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort()))),
              ).pipe(
                Effect.flatMap((settlement) => {
                  // Optional tool terminate: skip the next LLM call when a tool
                  // signals completion (Pi beforeToolCall / terminate). Default tools omit this.
                  const structured =
                    settlement.output && "structured" in settlement.output
                      ? (settlement.output as { structured?: unknown }).structured
                      : undefined
                  if (
                    SessionLoopControl.isToolTerminate(structured) ||
                    (settlement.result.type === "json" &&
                      SessionLoopControl.isToolTerminate(settlement.result.value))
                  ) {
                    terminateAfterTools = true
                    needsContinuation = false
                  }
                  return publish(
                    LLMEvent.toolResult({
                      id: event.id,
                      name: event.name,
                      result: settlement.result,
                      output: settlement.output,
                    }),
                    settlement.outputPaths ?? [],
                  )
                }),
              ),
            ).pipe(FiberSet.run(toolFibers))
          }),
        ),
        Effect.ensuring(withPublication(publisher.flush())),
      )

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          const failure =
            stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
          if (
            recoverOverflow &&
            !publisher.hasAssistantStarted() &&
            isContextOverflowFailure(overflowFailure ?? failure) &&
            (yield* restore(recoverOverflow({ sessionID: session.id, entries, model, request })))
          ) {
            savePoints.set(
              session.id,
              SessionLoopControl.refreshSavePoint({
                snapshot: turnSnapshot,
                previous: savePoints.get(session.id),
              }),
            )
            return yield* Effect.die(continueAfterOverflowCompaction(currentStep))
          }
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = failure instanceof LLMError ? failure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
            yield* withPublication(publisher.failAssistant(llmFailure.reason.message))
          }
          if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
          if (settled._tag === "Failure" && isQuestionRejected(settled.cause)) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            return yield* Effect.interrupt
          }
          if (
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          ) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            if (publisher.hasActiveAssistant())
              yield* withPublication(publisher.failAssistant("Provider turn interrupted"))
          }
          if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
            const failure = Cause.squash(settled.cause)
            const message = failure instanceof Error ? failure.message : String(failure)
            yield* withPublication(publisher.failUnsettledTools(`Tool execution failed: ${message}`))
          }
          const stepSettlement = publisher.stepSettlement()
          if (stepSettlement && !publisher.hasProviderError()) {
            const endSnapshot = yield* snapshots.capture()
            const files =
              startSnapshot && endSnapshot
                ? yield* snapshots
                    .files({ from: startSnapshot, to: endSnapshot })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined
            yield* withPublication(
              events.publish(SessionEvent.Step.Ended, {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                assistantMessageID: yield* publisher.startAssistant(),
                finish: stepSettlement.finish,
                cost: 0,
                tokens: stepSettlement.tokens,
                snapshot: endSnapshot,
                files,
              }),
            )
          }
          if (publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
          if (stream._tag === "Success" && !publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
            return yield* Effect.failCause(settled.cause)
          const continued = !terminateAfterTools && !publisher.hasProviderError() && needsContinuation
          return {
            needsContinuation: continued,
            terminated: terminateAfterTools,
            maxStepsReached: isLastStep,
            step: currentStep,
            snapshot: turnSnapshot,
          } satisfies TurnResult
        }),
      )
    }, Effect.scoped)
    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      savePoints: Map<string, SessionLoopControl.SavePoint>,
    ) => Effect.Effect<TurnResult, RunError>

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step, savePoints) {
      return yield* runTurnAttempt(sessionID, promotion, step, savePoints).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
            yield* Effect.yieldNow
            return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step, savePoints)
          }),
        ),
      )
    })

    const runTurn: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step, savePoints) {
      return yield* runTurnAttempt(sessionID, promotion, step, savePoints, compaction.compactAfterOverflow).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            yield* Effect.yieldNow
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step, savePoints)
            return yield* runTurn(sessionID, undefined, defect.transition.step, savePoints)
          }),
        ),
      )
    })

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      return yield* Effect.gen(function* () {
        const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
        const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
        if (!input.force && !hasSteer && !hasQueue) return
        yield* failInterruptedTools(input.sessionID)
        let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
        let shouldRun = input.force || hasSteer || hasQueue
        const savePoints = new Map<string, SessionLoopControl.SavePoint>()
        while (shouldRun) {
          let needsContinuation = true
          let step = 1
          while (needsContinuation) {
            const result = yield* runTurn(input.sessionID, promotion, step, savePoints)
            // After each successful turn, refresh the save-point so mid-run config
            // mutations only apply on the next turn.
            savePoints.set(
              input.sessionID,
              SessionLoopControl.refreshSavePoint({
                snapshot: result.snapshot,
                previous: savePoints.get(input.sessionID),
              }),
            )
            const stop = hooks.shouldStopAfterTurn({
              terminated: result.terminated,
              maxStepsReached: result.maxStepsReached,
              needsContinuation: result.needsContinuation,
            })
            needsContinuation = !stop
            step = result.step + 1
            promotion = "steer"
            if (!needsContinuation) needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
          }
          shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")
          promotion = shouldRun ? "queue" : undefined
        }
      }).pipe(Effect.ensuring(Effect.sync(() => doomLoopHistory.delete(input.sessionID as string))))
    })

    const compact = Effect.fn("SessionRunner.compact")(function* (sessionID: SessionSchema.ID) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      const system =
        (yield* SessionContextEpoch.initialize(db, loadSystemContext(agent), session.id)) ??
        (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.id))
      const model = yield* models.resolve(session)
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
      const request = LLM.request({
        model,
        messages: toLLMMessages(
          entries.map((entry) => entry.message),
          model,
        ),
        tools: [],
      })
      return yield* compaction.compactAfterOverflow({
        sessionID: session.id,
        entries,
        model,
        request,
        reason: "manual",
      })
    })

    return Service.of({
      run,
      compact,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    llmClient,
    AgentV2.node,
    ToolRegistry.node,
    SessionRunnerModel.node,
    SessionStore.node,
    Location.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    Config.node,
    Snapshot.node,
    Database.node,
    PermissionV2.node,
  ],
})
