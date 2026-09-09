import { stageLabel, type StageName } from "./state.ts"

export class Reporter {
  private version = ""
  private channel = ""
  private dryRun = false
  private current?: StageName
  private currentStarted = 0
  private readonly completed: Array<{ stage: StageName; durationMs: number; detail?: string }> = []

  begin(version: string, channel: string, dryRun: boolean): void {
    this.version = version
    this.channel = channel
    this.dryRun = dryRun
    console.log(`\nSpinosa release → v${version} (${channel})${dryRun ? " [dry-run]" : ""}`)
    console.log("─".repeat(40))
  }

  start(stage: StageName): void {
    this.current = stage
    this.currentStarted = performance.now()
    const prefix = this.dryRun ? "○" : "…"
    console.log(`${prefix} ${stageLabel(stage)}`)
  }

  detail(message: string): void {
    console.log(`  ${message}`)
  }

  complete(detail?: string): void {
    if (!this.current) return
    const durationMs = Math.round(performance.now() - this.currentStarted)
    this.completed.push({ stage: this.current, durationMs, detail })
    const suffix = detail ? ` — ${detail}` : ""
    const seconds = (durationMs / 1000).toFixed(1)
    console.log(`✓ ${stageLabel(this.current)} (${seconds}s)${suffix}`)
    this.current = undefined
  }

  skip(stage: StageName, reason: string): void {
    console.log(`↷ ${stageLabel(stage)} — ${reason}`)
  }

  fail(stage: StageName, error: string, resumeCommand: string): never {
    console.log(`✗ ${stageLabel(stage)} — ${error}`)
    console.log("─".repeat(40))
    for (const item of this.completed) {
      const seconds = (item.durationMs / 1000).toFixed(1)
      const suffix = item.detail ? ` — ${item.detail}` : ""
      console.log(`✓ ${stageLabel(item.stage)} (${seconds}s)${suffix}`)
    }
    console.log(`✗ ${stageLabel(stage)}`)
    console.log("─".repeat(40))
    console.log(`Resume: ${resumeCommand}`)
    process.exit(1)
  }

  done(): void {
    console.log("─".repeat(40))
    console.log(`✓ Released Spinosa v${this.version} (${this.channel})`)
  }
}
