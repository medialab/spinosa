/**
 * Shared timestamped console logging for release/build scripts.
 *
 * Long release steps (Lima guest boot, static compiles, binary builds) run
 * for minutes with no output — every line here carries a wall-clock time so
 * progress (and stalls) are visible, plus elapsed times on slow phases.
 * Dependency-free: works under bun and node.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

export function timestamp(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${pad(s % 60)}s`
}

/** Start an elapsed-time clock; call the result to get ms since start. */
export function startTimer(): () => number {
  const t0 = Date.now()
  return () => Date.now() - t0
}

/** New phase starting: `[12:01:11] [tools] → message`. */
export function step(tag: string, message: string): void {
  console.log(`[${timestamp()}] [${tag}] → ${message}`)
}

/** Plain progress line: `[12:01:11] [tools] message`. */
export function info(tag: string, message: string): void {
  console.log(`[${timestamp()}] [${tag}] ${message}`)
}

/** Phase finished: `[12:01:11] [tools] ✓ message (3m04s)`. */
export function ok(tag: string, message: string, elapsedMs?: number): void {
  const suffix = elapsedMs === undefined ? "" : ` (${fmtElapsed(elapsedMs)})`
  console.log(`[${timestamp()}] [${tag}] ✓ ${message}${suffix}`)
}

/** Non-fatal problem, still visible on stderr. */
export function warn(tag: string, message: string): void {
  console.warn(`[${timestamp()}] [${tag}] ! ${message}`)
}

/** Fatal error line on stderr, then throw (fail-closed for scripts). */
export function fail(tag: string, message: string): never {
  console.error(`[${timestamp()}] [${tag}] ✗ FATAL ${message}`)
  throw new Error(`[${tag}] FATAL ${message}`)
}
