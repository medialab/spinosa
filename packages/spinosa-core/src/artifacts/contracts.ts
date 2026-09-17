// WP3: Artifact validation contracts — what each artifact must contain.
// Validators in validate.ts enforce these; WorkflowEngine only consumes
// normalized StepOutcome. Never trust chat text as proof of an artifact.

export type ArtifactValidatorID =
  | "goal"
  | "evidence_packet"
  | "analysis"
  | "serendipity"
  | "visualization"
  | "report"
  | "verification"
  | "evaluation"
  | "extraction"
  | "maps"
  | "coverage"
  | "cleanup"

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string; retryable: boolean }

export const VERIFICATION_STATUSES = [
  "pass",
  "pass_with_corrections",
  "partial",
  "fail",
  "blocked",
] as const

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export function parseVerificationStatus(text: string): VerificationStatus | undefined {
  const m = text.match(/verification_status:\s*(\w+)/i) ?? text.match(/status:\s*(pass_with_corrections|pass|partial|fail|blocked)/i)
  const v = m?.[1]?.toLowerCase()
  return (VERIFICATION_STATUSES as readonly string[]).includes(v ?? "") ? (v as VerificationStatus) : undefined
}
