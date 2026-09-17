import type * as Provider from "./provider";
import { INCLUDE_ENCRYPTED_REASONING } from "./message-normalize";
import {
  anthropicAdaptiveEfforts,
  anthropicOmitsThinking,
  googleThinkingBudgetMax,
  googleThinkingVariants,
  openaiCompatibleReasoningEfforts,
  openaiReasoningEfforts,
  type ProviderVariant,
  type ProviderVariants,
  WIDELY_SUPPORTED_EFFORTS,
  wrapInSapModelParams,
} from "./variant-efforts";

type VariantContext = {
  model: Provider.Model;
  id: string;
  apiId: string;
  glm52: boolean;
  adaptiveThinkingOmitted: boolean;
  adaptiveEfforts: string[] | null;
};

export function variants(model: Provider.Model): ProviderVariants {
  if (!model.capabilities.reasoning) return {};

  const context = createContext(model);
  return specialVariants(context) ?? providerVariants(context);
}

function createContext(model: Provider.Model): VariantContext {
  const id = model.id.toLowerCase();
  const apiId = model.api.id.toLowerCase();
  return {
    model,
    id,
    apiId,
    glm52: ["glm-5.2", "glm-5-2", "glm-5p2"].some(
      (name) => id.includes(name) || apiId.includes(name),
    ),
    adaptiveThinkingOmitted: anthropicOmitsThinking(model.api.id),
    adaptiveEfforts: anthropicAdaptiveEfforts(model.api.id),
  };
}

function specialVariants(
  context: VariantContext,
): ProviderVariants | undefined {
  const { model, id, apiId } = context;

  if (
    apiId.includes("minimax-m3") &&
    ["@ai-sdk/anthropic", "@ai-sdk/openai-compatible"].includes(model.api.npm)
  ) {
    return {
      none: { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    };
  }

  const glmVariants = nativeGlmVariants(context);
  if (glmVariants) return glmVariants;

  if (isFixedModel(id, context.glm52)) return {};
  if (id.includes("grok")) return grokVariants(context);
  return undefined;
}

function nativeGlmVariants(
  context: VariantContext,
): ProviderVariants | undefined {
  if (!context.glm52) return undefined;

  const { model } = context;
  if (model.api.npm === "@openrouter/ai-sdk-provider") {
    return effortVariants(["high", "xhigh"], (effort) => ({
      reasoning: { effort },
    }));
  }
  if (model.api.npm === "@ai-sdk/openai-compatible") {
    return effortVariants(["high", "max"], (effort) => ({
      reasoningEffort: effort,
    }));
  }
  if (model.api.npm === "@ai-sdk/anthropic") {
    return effortVariants(["high", "max"], (effort) => ({ effort }));
  }
  return undefined;
}

function isFixedModel(id: string, glm52: boolean): boolean {
  return (
    [
      "deepseek-chat",
      "deepseek-reasoner",
      "deepseek-r1",
      "deepseek-v3",
      "minimax",
      "kimi",
      "k2p",
      "qwen",
      "big-pickle",
    ].some((name) => id.includes(name)) ||
    (id.includes("glm") && !glm52)
  );
}

function grokVariants(context: VariantContext): ProviderVariants {
  if (!context.id.includes("grok-3-mini")) return {};

  if (context.model.api.npm === "@openrouter/ai-sdk-provider") {
    return effortVariants(["low", "high"], (effort) => ({
      reasoning: { effort },
    }));
  }
  return effortVariants(["low", "high"], (effort) => ({
    reasoningEffort: effort,
  }));
}

function providerVariants(context: VariantContext): ProviderVariants {
  return PROVIDER_VARIANT_HANDLERS[context.model.api.npm]?.(context) ?? {};
}

type VariantHandler = (context: VariantContext) => ProviderVariants;

const PROVIDER_VARIANT_HANDLERS: Record<string, VariantHandler> = {
  "@openrouter/ai-sdk-provider": openRouterVariants,
  "ai-gateway-provider": cloudflareGatewayVariants,
  "@ai-sdk/gateway": gatewayVariants,
  "@ai-sdk/github-copilot": copilotVariants,
  "@ai-sdk/cerebras": openAICompatibleVariants,
  "@ai-sdk/togetherai": openAICompatibleVariants,
  "@ai-sdk/xai": openAICompatibleVariants,
  "@ai-sdk/deepinfra": openAICompatibleVariants,
  "venice-ai-sdk-provider": openAICompatibleVariants,
  "@ai-sdk/openai-compatible": openAICompatibleVariants,
  "@ai-sdk/azure": azureVariants,
  "@ai-sdk/amazon-bedrock/mantle": openAIVariants,
  "@ai-sdk/openai": openAIVariants,
  "@ai-sdk/anthropic": anthropicVariants,
  "@ai-sdk/google-vertex/anthropic": anthropicVariants,
  "@ai-sdk/amazon-bedrock": bedrockVariants,
  "@ai-sdk/google-vertex": (context) => googleThinkingVariants(context.model),
  "@ai-sdk/google": (context) => googleThinkingVariants(context.model),
  "@ai-sdk/mistral": mistralVariants,
  "@ai-sdk/cohere": emptyVariants,
  "@ai-sdk/perplexity": emptyVariants,
  "@ai-sdk/groq": () => groqVariants(),
  "@jerome-benoit/sap-ai-provider-v2": sapVariants,
};

function emptyVariants(_context: VariantContext): ProviderVariants {
  return {};
}

function openRouterVariants(context: VariantContext): ProviderVariants {
  const { model } = context;
  const efforts =
    model.api.id.startsWith("openai/") || context.id.includes("gpt")
      ? openaiCompatibleReasoningEfforts(model.api.id)
      : WIDELY_SUPPORTED_EFFORTS;
  return effortVariants(efforts, (effort) => ({ reasoning: { effort } }));
}

function cloudflareGatewayVariants(context: VariantContext): ProviderVariants {
  const efforts = context.model.api.id.startsWith("openai/")
    ? openaiReasoningEfforts(context.model.api.id, context.model.release_date)
    : WIDELY_SUPPORTED_EFFORTS;
  return effortVariants(efforts, (effort) => ({ reasoningEffort: effort }));
}

function gatewayVariants(context: VariantContext): ProviderVariants {
  if (context.model.id.includes("anthropic")) {
    return gatewayAnthropicVariants(context);
  }
  if (context.model.id.includes("google")) {
    return gatewayGoogleVariants(context);
  }
  return effortVariants(
    openaiCompatibleReasoningEfforts(context.model.api.id),
    (effort) => ({ reasoningEffort: effort }),
  );
}

function gatewayAnthropicVariants(context: VariantContext): ProviderVariants {
  if (!context.adaptiveEfforts) {
    return {
      high: { thinking: { type: "enabled", budgetTokens: 16000 } },
      max: { thinking: { type: "enabled", budgetTokens: 31999 } },
    };
  }

  return effortVariants(context.adaptiveEfforts, (effort) => ({
    thinking: {
      type: "adaptive",
      ...(context.adaptiveThinkingOmitted ? { display: "summarized" } : {}),
    },
    effort,
  }));
}

function gatewayGoogleVariants(context: VariantContext): ProviderVariants {
  if (context.id.includes("2.5")) {
    return {
      high: {
        thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 },
      },
      max: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: googleThinkingBudgetMax(context.id),
        },
      },
    };
  }

  return effortVariants(["low", "high"], (effort) => ({
    includeThoughts: true,
    thinkingLevel: effort,
  }));
}

function copilotVariants(context: VariantContext): ProviderVariants {
  if (context.model.id.includes("gemini")) return {};
  if (context.model.id.includes("claude")) {
    return effortVariants(WIDELY_SUPPORTED_EFFORTS, (effort) => ({
      reasoningEffort: effort,
    }));
  }

  return effortVariants(
    copilotEfforts(context.id, context.model.release_date),
    (effort) => ({
      reasoningEffort: effort,
      reasoningSummary: "auto",
      include: [...INCLUDE_ENCRYPTED_REASONING],
    }),
  );
}

function copilotEfforts(id: string, releaseDate: string): string[] {
  if (
    id.includes("5.1-codex-max") ||
    id.includes("5.2") ||
    id.includes("5.3")
  ) {
    return [...WIDELY_SUPPORTED_EFFORTS, "xhigh"];
  }

  const efforts: string[] = [...WIDELY_SUPPORTED_EFFORTS];
  if (id.includes("gpt-5") && releaseDate >= "2025-12-04") {
    efforts.push("xhigh");
  }
  return efforts;
}

function openAICompatibleVariants(context: VariantContext): ProviderVariants {
  if (context.apiId.includes("north-mini-code")) {
    return effortVariants(["none", "high"], (effort) => ({
      reasoningEffort: effort,
    }));
  }

  const efforts: string[] = [...WIDELY_SUPPORTED_EFFORTS];
  if (context.apiId.includes("deepseek-v4")) efforts.push("max");
  return effortVariants(efforts, (effort) => ({ reasoningEffort: effort }));
}

function azureVariants(context: VariantContext): ProviderVariants {
  if (context.id === "o1-mini") return {};
  return openAIReasoningVariants(
    openaiReasoningEfforts(context.id, context.model.release_date),
  );
}

function openAIVariants(context: VariantContext): ProviderVariants {
  return openAIReasoningVariants(
    openaiReasoningEfforts(context.model.api.id, context.model.release_date),
  );
}

function openAIReasoningVariants(efforts: readonly string[]): ProviderVariants {
  return effortVariants(efforts, (effort) => ({
    reasoningEffort: effort,
    reasoningSummary: "auto",
    include: [...INCLUDE_ENCRYPTED_REASONING],
  }));
}

function anthropicVariants(context: VariantContext): ProviderVariants {
  if (context.adaptiveEfforts) {
    return anthropicAdaptiveVariants(context);
  }

  if (["opus-4-5", "opus-4.5"].some((v) => context.model.api.id.includes(v))) {
    return effortVariants(WIDELY_SUPPORTED_EFFORTS, (effort) => ({ effort }));
  }

  return {
    high: {
      thinking: {
        type: "enabled",
        budgetTokens: Math.min(
          16_000,
          Math.floor(context.model.limit.output / 2 - 1),
        ),
      },
    },
    max: {
      thinking: {
        type: "enabled",
        budgetTokens: Math.min(31_999, context.model.limit.output - 1),
      },
    },
  };
}

function anthropicAdaptiveVariants(context: VariantContext): ProviderVariants {
  let efforts = [...(context.adaptiveEfforts ?? [])];
  if (context.model.providerID === "github-copilot") {
    if (context.model.api.id.includes("opus-4.7")) efforts = ["medium"];
    efforts = efforts.filter(
      (effort) => effort !== "max" && effort !== "xhigh",
    );
  }

  return effortVariants(efforts, (effort) => ({
    thinking: {
      type: "adaptive",
      ...(context.adaptiveThinkingOmitted ? { display: "summarized" } : {}),
    },
    effort,
  }));
}

function bedrockVariants(context: VariantContext): ProviderVariants {
  if (context.adaptiveEfforts) {
    return effortVariants(context.adaptiveEfforts, (effort) => ({
      reasoningConfig: {
        type: "adaptive",
        maxReasoningEffort: effort,
        ...(context.adaptiveThinkingOmitted ? { display: "summarized" } : {}),
      },
    }));
  }

  if (context.model.api.id.includes("anthropic")) {
    return {
      high: { reasoningConfig: { type: "enabled", budgetTokens: 16000 } },
      max: { reasoningConfig: { type: "enabled", budgetTokens: 31999 } },
    };
  }

  return effortVariants(WIDELY_SUPPORTED_EFFORTS, (effort) => ({
    reasoningConfig: {
      type: "enabled",
      maxReasoningEffort: effort,
    },
  }));
}

const MISTRAL_REASONING_IDS = [
  "mistral-small-2603",
  "mistral-small-latest",
  "mistral-medium-3.5",
  "mistral-medium-2604",
];

function mistralVariants(context: VariantContext): ProviderVariants {
  if (
    !MISTRAL_REASONING_IDS.some((id) =>
      context.model.api.id.toLowerCase().includes(id),
    )
  ) {
    return {};
  }
  return { high: { reasoningEffort: "high" } };
}

function groqVariants(): ProviderVariants {
  return effortVariants(["none", ...WIDELY_SUPPORTED_EFFORTS], (effort) => ({
    reasoningEffort: effort,
  }));
}

function sapVariants(context: VariantContext): ProviderVariants {
  const { id, model } = context;
  if (id.includes("anthropic")) {
    return sapAnthropicVariants(context);
  }
  if (id.includes("gemini") && id.includes("2.5")) {
    return wrapInSapModelParams(googleThinkingVariants(model));
  }
  if (id.includes("gpt") || /\bo[1-9]/.test(id)) {
    return wrapInSapModelParams(
      effortVariants(
        openaiReasoningEfforts(id, model.release_date),
        (effort) => ({ reasoning_effort: effort }),
      ),
    );
  }
  return wrapInSapModelParams(
    effortVariants(["low", "medium", "high"], (effort) => ({
      reasoning_effort: effort,
    })),
  );
}

function sapAnthropicVariants(context: VariantContext): ProviderVariants {
  if (context.adaptiveEfforts) {
    return wrapInSapModelParams(
      effortVariants(context.adaptiveEfforts, (effort) => ({
        thinking: {
          type: "adaptive",
          ...(context.adaptiveThinkingOmitted ? { display: "summarized" } : {}),
        },
        output_config: { effort },
      })),
    );
  }

  return wrapInSapModelParams({
    high: { thinking: { type: "enabled", budget_tokens: 16000 } },
    max: { thinking: { type: "enabled", budget_tokens: 31999 } },
  });
}

function effortVariants(
  efforts: readonly string[],
  create: (effort: string) => ProviderVariant,
): ProviderVariants {
  return Object.fromEntries(efforts.map((effort) => [effort, create(effort)]));
}
