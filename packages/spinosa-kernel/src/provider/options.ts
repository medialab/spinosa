import { isJSONObject } from "@ai-sdk/provider";
import type { JSONValue } from "@ai-sdk/provider";
import type * as Provider from "./provider";
import { INCLUDE_ENCRYPTED_REASONING } from "./message-normalize";
import type { ProviderVariant } from "./variant-efforts";

type ProviderOptions = Record<string, JSONValue | undefined>;

export function options(input: {
  model: Provider.Model;
  sessionID: string;
  providerOptions?: Record<string, unknown>;
}): ProviderOptions {
  const result: ProviderOptions = {};
  const { model, sessionID, providerOptions } = input;
  const { api, capabilities, providerID } = model;
  const modelId = api.id.toLowerCase();

  addAnthropicDefaults(result, model);
  addOpenAIDefaults(result, model, sessionID);
  addGatewayDefaults(result, model);
  addProviderThinkingDefaults(result, model);

  if (api.npm === "@ai-sdk/google" || api.npm === "@ai-sdk/google-vertex") {
    addGoogleThinking(result, model, modelId);
  }

  if (modelId.includes("minimax-m3") && api.npm === "@ai-sdk/anthropic") {
    result.thinking = { type: "adaptive" };
  }

  if (
    (api.npm === "@ai-sdk/anthropic" ||
      api.npm === "@ai-sdk/google-vertex/anthropic") &&
    isKimiThinkingModel(modelId)
  ) {
    result.thinking = {
      type: "enabled",
      budgetTokens: Math.min(16_000, Math.floor(model.limit.output / 2 - 1)),
    };
  }

  if (
    providerID === "alibaba-cn" &&
    capabilities.reasoning &&
    api.npm === "@ai-sdk/openai-compatible" &&
    !modelId.includes("kimi-k2-thinking")
  ) {
    result.enable_thinking = true;
  }

  if (api.npm === "@ai-sdk/azure" && api.id.includes("gpt-5.5")) {
    result.reasoningSummary = "auto";
    return result;
  }

  addGpt5Defaults(result, model, sessionID);
  addOpenAIReasoningSummaryDefaults(result, model);
  addCacheKeys(result, model, sessionID, providerOptions);
  return result;
}

function addAnthropicDefaults(
  result: ProviderOptions,
  model: Provider.Model,
): void {
  if (
    model.api.npm === "@ai-sdk/google-vertex/anthropic" ||
    (!model.api.id.includes("claude") && model.api.npm === "@ai-sdk/anthropic")
  ) {
    result.toolStreaming = false;
  }
}

function addOpenAIDefaults(
  result: ProviderOptions,
  model: Provider.Model,
  sessionID: string,
): void {
  if (
    model.providerID === "openai" ||
    model.api.npm === "@ai-sdk/openai" ||
    model.api.npm === "@ai-sdk/github-copilot" ||
    model.api.npm === "@ai-sdk/amazon-bedrock/mantle"
  ) {
    result.store = false;
  }

  if (model.api.npm === "@ai-sdk/azure") {
    result.store = false;
    result.promptCacheKey = sessionID;
  }
}

function addGatewayDefaults(
  result: ProviderOptions,
  model: Provider.Model,
): void {
  if (
    model.api.npm !== "@openrouter/ai-sdk-provider" &&
    model.api.npm !== "@llmgateway/ai-sdk-provider"
  ) {
    return;
  }

  result.usage = { include: true };
  if (model.api.id.includes("gemini-3")) {
    result.reasoning = { effort: "high" };
  }
}

function addProviderThinkingDefaults(
  result: ProviderOptions,
  model: Provider.Model,
): void {
  if (
    model.providerID === "baseten" ||
    (model.providerID === "opencode" &&
      ["kimi-k2-thinking", "glm-4.6"].includes(model.api.id))
  ) {
    result.chat_template_args = { enable_thinking: true };
  }

  if (
    ["zai", "zhipuai"].some((id) => model.providerID.includes(id)) &&
    model.api.npm === "@ai-sdk/openai-compatible"
  ) {
    result.thinking = { type: "enabled", clear_thinking: false };
  }
}

function addGoogleThinking(
  result: ProviderOptions,
  model: Provider.Model,
  modelId: string,
): void {
  if (!model.capabilities.reasoning) return;

  result.thinkingConfig = { includeThoughts: true };
  if (modelId.includes("gemini-3") && isJSONObject(result.thinkingConfig)) {
    result.thinkingConfig.thinkingLevel = "high";
  }
}

function addGpt5Defaults(
  result: ProviderOptions,
  model: Provider.Model,
  sessionID: string,
): void {
  if (!model.api.id.includes("gpt-5") || model.api.id.includes("gpt-5-chat")) {
    return;
  }

  if (!model.api.id.includes("gpt-5-pro")) {
    result.reasoningEffort = "medium";
    if (
      model.api.npm === "@ai-sdk/openai" ||
      model.api.npm === "@ai-sdk/azure" ||
      model.api.npm === "@ai-sdk/github-copilot" ||
      model.api.npm === "@ai-sdk/amazon-bedrock/mantle"
    ) {
      result.reasoningSummary = "auto";
    }
    if (
      model.api.npm === "@ai-sdk/openai" ||
      model.api.npm === "@ai-sdk/amazon-bedrock/mantle"
    ) {
      result.include = [...INCLUDE_ENCRYPTED_REASONING];
    }
  }

  if (
    model.api.id.includes("gpt-5.") &&
    !model.api.id.includes("codex") &&
    !model.api.id.includes("-chat") &&
    model.providerID !== "azure"
  ) {
    result.textVerbosity = "low";
  }

  if (model.providerID.startsWith("opencode")) {
    result.promptCacheKey = sessionID;
    result.include = [...INCLUDE_ENCRYPTED_REASONING];
    result.reasoningSummary = "auto";
  }
}

// The Responses API only emits reasoning summary SSE events
// (`response.reasoning_summary_text.delta`) when the request asks for them.
// Without `reasoningSummary`, a reasoning model streams zero reasoning parts,
// so the TUI renders no Thinking row to toggle — while chat-completions-based
// providers stream reasoning_content by default. Request the summary (plus the
// encrypted blob needed for stateless multi-turn continuity) for every
// OpenAI-family reasoning model, not just gpt-5, so both surfaces match.
// o1* predates summaries and gpt-5-chat is not a reasoning model.
function addOpenAIReasoningSummaryDefaults(result: ProviderOptions, model: Provider.Model): void {
  if (!model.capabilities.reasoning) return;
  const modelId = model.api.id.toLowerCase();
  if (modelId.startsWith("o1") || modelId.includes("gpt-5-chat")) return;
  switch (model.api.npm) {
    case "@ai-sdk/openai":
    case "@ai-sdk/azure":
    case "@ai-sdk/github-copilot":
    case "@ai-sdk/amazon-bedrock/mantle":
      break;
    default:
      return;
  }
  result.reasoningSummary ??= "auto";
  if (model.api.npm === "@ai-sdk/openai" || model.api.npm === "@ai-sdk/amazon-bedrock/mantle") {
    result.include ??= [...INCLUDE_ENCRYPTED_REASONING];
  }
}

function addCacheKeys(
  result: ProviderOptions,
  model: Provider.Model,
  sessionID: string,
  providerOptions: Record<string, unknown> | undefined,
): void {
  if (model.providerID === "openai" || providerOptions?.setCacheKey) {
    result.promptCacheKey = sessionID;
  }
  if (model.providerID === "venice") result.promptCacheKey = sessionID;
  if (model.providerID === "openrouter") result.prompt_cache_key = sessionID;
  if (model.api.npm === "@ai-sdk/gateway") {
    result.gateway = { caching: "auto" };
  }
}

function isKimiThinkingModel(modelId: string): boolean {
  return (
    modelId.includes("k2p") ||
    modelId.includes("kimi-k2.") ||
    modelId.includes("kimi-k2p")
  );
}

export function smallOptions(model: Provider.Model): ProviderOptions {
  const small = firstVariant(model.variants);
  if (
    model.providerID === "openai" ||
    model.api.npm === "@ai-sdk/openai" ||
    model.api.npm === "@ai-sdk/github-copilot"
  ) {
    return { store: false, ...small };
  }

  if (model.providerID === "openrouter" || model.providerID === "llmgateway") {
    if (model.providerID === "openrouter" && hasLowReasoning(small)) {
      return { reasoning: { effort: "none" } };
    }
    if (Object.keys(small).length === 0 && model.api.id.includes("google")) {
      return { reasoning: { enabled: false } };
    }
  }

  if (model.providerID === "venice") {
    if (Object.keys(small).length > 0) return small;
    return { veniceParameters: { disableThinking: true } };
  }

  return small;
}

function firstVariant(variants: Provider.Model["variants"]): ProviderVariant {
  const value = variants ? Object.values(variants)[0] : undefined;
  return isJSONObject(value) ? value : {};
}

function hasLowReasoning(variant: ProviderVariant): boolean {
  const reasoning = variant.reasoning;
  return isJSONObject(reasoning) && reasoning.effort === "low";
}
