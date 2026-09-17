/**
 * Two-stage Esc for stopping a live run: first press arms, second press on
 * the same target confirms. Binding the arm to the target prevents an Esc
 * pressed in one session from later killing another.
 */
export const ESC_ARM_WINDOW_MS = 10_000

export function escConfirmStop(
  armedAt: number | undefined,
  armedTarget: string | undefined,
  target: string,
  now: number = Date.now(),
): boolean {
  return armedTarget === target && typeof armedAt === "number" && armedAt > 0 && now - armedAt < ESC_ARM_WINDOW_MS
}
