import type { JSONValue } from "@ai-sdk/provider";
import type * as Provider from "./provider";

export type ProviderVariant = Record<string, JSONValue | undefined>;
export type ProviderVariants = Record<string, ProviderVariant>;

export const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"] as const;

const OPENAI_EFFORTS = [
  "none",
  "minimal",
  ...WIDELY_SUPPORTED_EFFORTS,
  "xhigh",
];
const OPENAI_GPT5_1_EFFORTS = ["none", ...WIDELY_SUPPORTED_EFFORTS];
const OPENAI_GPT5_2_PLUS_EFFORTS = [...OPENAI_GPT5_1_EFFORTS, "xhigh"];
const OPENAI_GPT5_PRO_EFFORTS = ["high"];
const OPENAI_GPT5_PRO_2_PLUS_EFFORTS = ["medium", "high", "xhigh"];
const OPENAI_GPT5_CHAT_EFFORTS = ["medium"];
const OPENAI_GPT5_CODEX_XHIGH_EFFORTS = [...WIDELY_SUPPORTED_EFFORTS, "xhigh"];
const OPENAI_GPT5_CODEX_3_PLUS_EFFORTS = [
  "none",
  ...OPENAI_GPT5_CODEX_XHIGH_EFFORTS,
];

// OpenAI rolled out the `none` reasoning_effort tier on this date (Responses API).
// Models released before it 400 on `reasoning_effort: "none"`, so we only expose
// it as a variant for models new enough to accept it.
const OPENAI_NONE_EFFORT_RELEASE_DATE = "2025-11-13";

// OpenAI rolled out the `xhigh` reasoning_effort tier on this date. Same reasoning.
const OPENAI_XHIGH_EFFORT_RELEASE_DATE = "2025-12-04";

// Matches members of the gpt-5 family across the id formats we encounter:
//   "gpt-5", "gpt-5-nano", "gpt-5.4", "openai/gpt-5.4-codex".
// Anchored to start-of-string or "/" so it doesn't false-match "gpt-50" or "gpt-5o".
const GPT5_FAMILY_RE = /(?:^|\/)gpt-5(?:[.-]|$)/;
const GPT5_VERSION_RE = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/;
const GPT5_PRO_RE = /(?:^|\/)gpt-5[.-]?pro(?:[.-]|$)/;
const GPT5_VERSIONED_PRO_RE = /(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/;

function gpt5Version(apiId: string) {
  return Number(GPT5_VERSION_RE.exec(apiId)?.[1]) || undefined;
}

function versionedGpt5ReasoningEfforts(apiId: string) {
  if (GPT5_VERSIONED_PRO_RE.test(apiId)) return OPENAI_GPT5_PRO_2_PLUS_EFFORTS;
  const version = gpt5Version(apiId);
  if (version === undefined) return undefined;
  if (version === 1) return OPENAI_GPT5_1_EFFORTS;
  return OPENAI_GPT5_2_PLUS_EFFORTS;
}

function gpt5CodexReasoningEfforts(apiId: string) {
  if (!GPT5_FAMILY_RE.test(apiId) || !apiId.includes("codex")) return undefined;
  const version = gpt5Version(apiId);
  if (version !== undefined && version >= 3)
    return OPENAI_GPT5_CODEX_3_PLUS_EFFORTS;
  if (apiId.includes("codex-max") || (version !== undefined && version >= 2))
    return OPENAI_GPT5_CODEX_XHIGH_EFFORTS;
  return WIDELY_SUPPORTED_EFFORTS;
}

function gpt5ChatReasoningEfforts(apiId: string) {
  if (!GPT5_FAMILY_RE.test(apiId) || !apiId.includes("-chat")) return undefined;
  return gpt5Version(apiId) === undefined ? [] : OPENAI_GPT5_CHAT_EFFORTS;
}

// Computes the reasoning_effort tiers an OpenAI (or OpenAI-compatible upstream
// routed through it, e.g. cf-ai-gateway) model exposes. Effort order: weakest
// to strongest.
export function openaiReasoningEfforts(apiId: string, releaseDate: string) {
  const id = apiId.toLowerCase();
  if (id.includes("deep-research")) return ["medium"];
  const chatEfforts = gpt5ChatReasoningEfforts(id);
  if (chatEfforts) return chatEfforts;
  if (GPT5_PRO_RE.test(id)) return OPENAI_GPT5_PRO_EFFORTS;
  const codexEfforts = gpt5CodexReasoningEfforts(id);
  if (codexEfforts) return codexEfforts;
  const versionedEfforts = versionedGpt5ReasoningEfforts(id);
  // GPT-5.1 replaced GPT-5's `minimal` effort with `none`; GPT-5.2+
  // additionally accepts `xhigh`. Model pages list the supported subset.
  if (versionedEfforts) return versionedEfforts;
  const efforts: string[] = [...WIDELY_SUPPORTED_EFFORTS];
  if (GPT5_FAMILY_RE.test(id)) efforts.unshift("minimal");
  if (releaseDate >= OPENAI_NONE_EFFORT_RELEASE_DATE) efforts.unshift("none");
  if (releaseDate >= OPENAI_XHIGH_EFFORT_RELEASE_DATE) efforts.push("xhigh");
  return efforts;
}

export function openaiCompatibleReasoningEfforts(id: string) {
  const apiId = id.toLowerCase();
  const chatEfforts = gpt5ChatReasoningEfforts(apiId);
  if (chatEfforts) return chatEfforts;
  if (GPT5_PRO_RE.test(apiId)) return OPENAI_GPT5_PRO_EFFORTS;
  return (
    gpt5CodexReasoningEfforts(apiId) ??
    versionedGpt5ReasoningEfforts(apiId) ??
    OPENAI_EFFORTS
  );
}

function anthropicOpus47OrLater(apiId: string) {
  // Matches "opus-4.7" (Anthropic/Bedrock/Vertex) and "claude-4.7-opus" (SAP AI Core inverted).
  // Greedy \d+ correctly extends to multi-digit majors (e.g. "claude-10.0-opus") for forward compatibility.
  const version =
    /opus-(\d+)[.-](\d+)(?:[.@-]|$)|claude-(\d+)[.-](\d+)-opus(?:[.@-]|$)/i.exec(
      apiId,
    );
  if (!version) return false;
  const major = Number(version[1] ?? version[3]);
  const minor = Number(version[2] ?? version[4]);
  return major > 4 || (major === 4 && minor >= 7);
}

function anthropicSonnet5OrLater(apiId: string) {
  const version =
    /sonnet-(\d+)(?:[.@-]|$)|claude-(\d+)-sonnet(?:[.@-]|$)/i.exec(apiId);
  if (!version) return false;
  return Number(version[1] ?? version[2]) >= 5;
}

export function anthropicAdaptiveEfforts(apiId: string): string[] | null {
  if (
    anthropicOpus47OrLater(apiId) ||
    anthropicSonnet5OrLater(apiId) ||
    apiId.includes("fable-5")
  ) {
    return ["low", "medium", "high", "xhigh", "max"];
  }
  if (
    [
      "opus-4-6",
      "opus-4.6",
      "4-6-opus",
      "4.6-opus",
      "sonnet-4-6",
      "sonnet-4.6",
      "4-6-sonnet",
      "4.6-sonnet",
    ].some((v) => apiId.includes(v))
  ) {
    return ["low", "medium", "high", "max"];
  }
  return null;
}

export function anthropicOmitsThinking(apiId: string) {
  return (
    anthropicOpus47OrLater(apiId) ||
    anthropicSonnet5OrLater(apiId) ||
    apiId.includes("fable-5")
  );
}

function googleThinkingLevelEfforts(apiId: string) {
  const id = apiId.toLowerCase();
  if (!id.includes("gemini-3")) return ["low", "high"];
  if (id.includes("flash-image")) return ["minimal", "high"];
  if (id.includes("pro-image")) return ["high"];
  if (id.includes("flash")) return ["minimal", "low", "medium", "high"];
  return ["low", "medium", "high"];
}

export function googleThinkingBudgetMax(apiId: string) {
  const id = apiId.toLowerCase();
  if (id.includes("2.5") && id.includes("pro") && !id.includes("flash"))
    return 32_768;
  return 24_576;
}

// SAP's Zod schema drops unknown top-level keys; reasoning controls survive
// only via `modelParams` (catchall), forwarded verbatim by the SAP SDKs.
export function wrapInSapModelParams(
  variants: ProviderVariants,
): ProviderVariants {
  return Object.fromEntries(
    Object.entries(variants).map(([k, v]) => [k, { modelParams: v }]),
  );
}

export function googleThinkingVariants(
  model: Provider.Model,
): ProviderVariants {
  const id = model.api.id.toLowerCase();
  if (id.includes("2.5")) {
    return {
      high: {
        thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 },
      },
      max: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: googleThinkingBudgetMax(id),
        },
      },
    };
  }
  return Object.fromEntries(
    googleThinkingLevelEfforts(id).map((effort) => [
      effort,
      { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } },
    ]),
  );
}
