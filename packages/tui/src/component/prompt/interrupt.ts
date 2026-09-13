/**
 * Two-stage Esc for stopping a live run: first press arms (warn), second
 * press within the window confirms the stop. A lone Esc never kills a run.
 * Cancelling routing (evaluating) stays single-press — nothing was sent.
 */
export const ESC_ARM_WINDOW_MS = 10_000

export function escConfirmStop(armedAt: number | undefined, now: number = Date.now()): boolean {
  return typeof armedAt === "number" && armedAt > 0 && now - armedAt < ESC_ARM_WINDOW_MS
}
