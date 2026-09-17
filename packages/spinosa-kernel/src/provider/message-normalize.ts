import type { ModelMessage, ToolResultPart } from "ai";
import type * as ModelsDev from "@spinosa/kernel-core/models-dev";
import type * as Provider from "./provider";

export type JsonRecord = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Modality = NonNullable<ModelsDev.Model["modalities"]>["input"][number];

type ReasoningPart = {
  readonly type: "reasoning";
  readonly text?: string;
};

function isReasoningPart(part: unknown): part is ReasoningPart {
  return (
    isPlainObject(part) &&
    part.type === "reasoning" &&
    (part.text === undefined || typeof part.text === "string")
  );
}

export function mimeToModality(mime: string): Modality | undefined {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return undefined;
}

export const OUTPUT_TOKEN_MAX = 32_000;

// OpenAI Responses `include` value that returns the encrypted reasoning state
// needed for stateless multi-turn reasoning (store: false).
export const INCLUDE_ENCRYPTED_REASONING = [
  "reasoning.encrypted_content",
] as const;

export function sanitizeSurrogates(content: string): string {
  return content.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
}

// Maps npm package to the key the AI SDK expects for providerOptions.
export function sdkKey(npm: string): string | undefined {
  switch (npm) {
    case "@ai-sdk/github-copilot":
      return "copilot";
    case "@ai-sdk/azure":
      return "azure";
    case "@ai-sdk/openai":
      return "openai";
    case "@ai-sdk/amazon-bedrock/mantle":
      return "openai";
    case "@ai-sdk/amazon-bedrock":
      return "bedrock";
    case "@ai-sdk/anthropic":
    case "@ai-sdk/google-vertex/anthropic":
      return "anthropic";
    case "@ai-sdk/google-vertex":
      return "vertex";
    case "@ai-sdk/google":
      return "google";
    case "@ai-sdk/gateway":
      return "gateway";
    case "@openrouter/ai-sdk-provider":
      return "openrouter";
    case "ai-gateway-provider":
      // Unified provider reads options from the canonical camelCase key.
      return "openaiCompatible";
    default:
      return undefined;
  }
}

export function normalizeMessages(
  msgs: ModelMessage[],
  model: Provider.Model,
  _options: Record<string, unknown>,
): ModelMessage[] {
  let normalized = msgs.map(normalizeMessage);
  normalized = normalizeProviderContent(normalized, model);

  if (isMistralModel(model)) {
    return normalizeMistralMessages(normalized);
  }

  if (model.api.id.toLowerCase().includes("deepseek")) {
    normalized = addDeepseekReasoning(normalized);
  }

  const field = interleavedField(model);
  return field ? normalizeInterleavedMessages(normalized, field) : normalized;
}

function normalizeMessage(msg: ModelMessage): ModelMessage {
  switch (msg.role) {
    case "tool":
      return normalizeToolMessage(msg);
    case "system":
      msg.content = sanitizeSurrogates(msg.content);
      return msg;
    case "user":
      return normalizeUserMessage(msg);
    case "assistant":
      return normalizeAssistantMessage(msg);
    default:
      return msg;
  }
}

function normalizeToolMessage(msg: ModelMessage): ModelMessage {
  if (msg.role !== "tool" || !Array.isArray(msg.content)) return msg;
  msg.content = msg.content.map((content) =>
    content.type === "tool-result"
      ? sanitizeToolResultOutput(content)
      : content,
  );
  return msg;
}

function normalizeUserMessage(msg: ModelMessage): ModelMessage {
  if (msg.role !== "user") return msg;
  if (typeof msg.content === "string") {
    msg.content = sanitizeSurrogates(msg.content);
    return msg;
  }
  msg.content = msg.content.map((content) => {
    if (content.type === "text")
      content.text = sanitizeSurrogates(content.text);
    return content;
  });
  return msg;
}

function normalizeAssistantMessage(msg: ModelMessage): ModelMessage {
  if (msg.role !== "assistant") return msg;
  if (typeof msg.content === "string") {
    msg.content = sanitizeSurrogates(msg.content);
    return msg;
  }
  msg.content = msg.content.map((content) => {
    if (content.type === "text" || content.type === "reasoning") {
      content.text = sanitizeSurrogates(content.text);
    }
    if (content.type === "tool-result")
      return sanitizeToolResultOutput(content);
    return content;
  });
  return msg;
}

function sanitizeToolResultOutput(content: ToolResultPart): ToolResultPart {
  if (content.output.type === "text" || content.output.type === "error-text") {
    content.output.value = sanitizeSurrogates(content.output.value);
  }
  if (content.output.type === "content") {
    content.output.value = content.output.value.map((item) => {
      if (item.type === "text") item.text = sanitizeSurrogates(item.text);
      return item;
    });
  }
  return content;
}

function normalizeProviderContent(
  msgs: ModelMessage[],
  model: Provider.Model,
): ModelMessage[] {
  let normalized = msgs;
  if (
    model.api.npm === "@ai-sdk/anthropic" ||
    model.api.npm === "@ai-sdk/amazon-bedrock"
  ) {
    const provider =
      model.api.npm === "@ai-sdk/anthropic" ? "anthropic" : "bedrock";
    normalized = filterEmptyContentMessages(normalized, provider);
  }

  if (model.api.id.includes("claude")) {
    normalized = normalized.map((msg) =>
      mapMessageToolCallIds(msg, (id) => id.replace(/[^a-zA-Z0-9_-]/g, "")),
    );
  }
  return normalized;
}

function isMistralModel(model: Provider.Model): boolean {
  const id = model.api.id.toLowerCase();
  return (
    model.providerID === "mistral" ||
    id.includes("mistral") ||
    id.includes("devstral")
  );
}

function normalizeMistralMessages(msgs: ModelMessage[]): ModelMessage[] {
  const normalized = msgs.map((msg) =>
    mapMessageToolCallIds(msg, (id) =>
      id
        .replace(/[^a-zA-Z0-9]/g, "")
        .substring(0, 9)
        .padEnd(9, "0"),
    ),
  );
  const result: ModelMessage[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const msg = normalized[i];
    result.push(msg);
    if (msg.role === "tool" && normalized[i + 1]?.role === "user") {
      result.push({
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
      });
    }
  }
  return result;
}

function mapMessageToolCallIds(
  msg: ModelMessage,
  scrub: (id: string) => string,
): ModelMessage {
  if (msg.role === "assistant" && Array.isArray(msg.content)) {
    return {
      ...msg,
      content: msg.content.map((part) =>
        part.type === "tool-call" || part.type === "tool-result"
          ? { ...part, toolCallId: scrub(part.toolCallId) }
          : part,
      ),
    };
  }
  if (msg.role === "tool" && Array.isArray(msg.content)) {
    return {
      ...msg,
      content: msg.content.map((part) =>
        part.type === "tool-result"
          ? { ...part, toolCallId: scrub(part.toolCallId) }
          : part,
      ),
    };
  }
  return msg;
}

function addDeepseekReasoning(msgs: ModelMessage[]): ModelMessage[] {
  return msgs.map((msg) => {
    if (msg.role !== "assistant") return msg;
    if (Array.isArray(msg.content)) {
      if (msg.content.some((part) => part.type === "reasoning")) return msg;
      return {
        ...msg,
        content: [...msg.content, { type: "reasoning", text: "" }],
      };
    }
    return {
      ...msg,
      content: [
        ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
        { type: "reasoning" as const, text: "" },
      ],
    };
  });
}

function interleavedField(model: Provider.Model): string | undefined {
  if (
    typeof model.capabilities.interleaved !== "object" ||
    !model.capabilities.interleaved.field ||
    model.api.npm === "@openrouter/ai-sdk-provider"
  ) {
    return undefined;
  }
  return model.capabilities.interleaved.field;
}

function normalizeInterleavedMessages(
  msgs: ModelMessage[],
  field: string,
): ModelMessage[] {
  return msgs.map((msg) => {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg;

    const reasoningText = msg.content
      .filter((part) => part.type === "reasoning")
      .map((part) => (isReasoningPart(part) ? (part.text ?? "") : ""))
      .join("");
    const filteredContent = msg.content.filter(
      (part) => part.type !== "reasoning",
    );

    return {
      ...msg,
      content: filteredContent,
      providerOptions: {
        ...msg.providerOptions,
        openaiCompatible: {
          ...msg.providerOptions?.openaiCompatible,
          [field]: reasoningText,
        },
      },
    };
  });
}

type ReasoningMetadataProvider = "anthropic" | "bedrock";

function hasReasoningMetadata(
  part: { providerOptions?: ModelMessage["providerOptions"] },
  provider: ReasoningMetadataProvider,
): boolean {
  if (!isPlainObject(part.providerOptions)) return false;
  const metadata = part.providerOptions[provider];
  if (!isPlainObject(metadata)) return false;
  return metadata.signature != null || metadata.redactedData != null;
}

function filterEmptyContentMessages(
  msgs: ModelMessage[],
  provider: ReasoningMetadataProvider,
): ModelMessage[] {
  return msgs
    .map((msg) => {
      if (typeof msg.content === "string") {
        return msg.content === "" ? undefined : msg;
      }
      if (!Array.isArray(msg.content)) return msg;
      const filtered = msg.content.filter((part) => {
        if (part.type === "text") return part.text !== "";
        if (part.type === "reasoning") {
          return (
            part.text.trim().length > 0 || hasReasoningMetadata(part, provider)
          );
        }
        return true;
      });
      return filtered.length === 0 ? undefined : { ...msg, content: filtered };
    })
    .filter(
      (msg): msg is ModelMessage => msg !== undefined && msg.content !== "",
    );
}
