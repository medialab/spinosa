import type { ModelMessage } from "ai";
import type { JSONObject } from "@ai-sdk/provider";
import { mergeDeep, unique } from "remeda";
import type * as Provider from "./provider";
import { mimeToModality, normalizeMessages, sdkKey } from "./message-normalize";

type MessageProviderOptions = NonNullable<ModelMessage["providerOptions"]>;
type ProviderOptionsTransform = (
  options: MessageProviderOptions | undefined,
) => MessageProviderOptions | undefined;

function applyCaching(
  msgs: ModelMessage[],
  model: Provider.Model,
): ModelMessage[] {
  const system = msgs.filter((msg) => msg.role === "system").slice(0, 2);
  const final = msgs.filter((msg) => msg.role !== "system").slice(-2);

  const providerOptions = {
    anthropic: {
      cacheControl: { type: "ephemeral" },
    },
    openrouter: {
      cacheControl: { type: "ephemeral" },
    },
    bedrock: {
      cachePoint: { type: "default" },
    },
    openaiCompatible: {
      cache_control: { type: "ephemeral" },
    },
    copilot: {
      copilot_cache_control: { type: "ephemeral" },
    },
    alibaba: {
      cacheControl: { type: "ephemeral" },
    },
  };

  for (const msg of unique([...system, ...final])) {
    const useMessageLevelOptions =
      model.providerID === "anthropic" ||
      model.providerID.includes("bedrock") ||
      model.api.npm === "@ai-sdk/amazon-bedrock";
    const shouldUseContentOptions =
      !useMessageLevelOptions &&
      Array.isArray(msg.content) &&
      msg.content.length > 0;

    if (shouldUseContentOptions) {
      const lastContent = msg.content[msg.content.length - 1];
      if (
        lastContent &&
        typeof lastContent === "object" &&
        lastContent.type !== "tool-approval-request" &&
        lastContent.type !== "tool-approval-response"
      ) {
        lastContent.providerOptions = mergeDeep(
          lastContent.providerOptions ?? {},
          providerOptions,
        );
        continue;
      }
    }

    msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, providerOptions);
  }

  return msgs;
}

function unsupportedParts(
  msgs: ModelMessage[],
  model: Provider.Model,
): ModelMessage[] {
  return msgs.map((msg) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;

    const filtered = msg.content.map((part) => {
      if (part.type !== "file" && part.type !== "image") return part;

      // Check for empty base64 image data
      if (part.type === "image") {
        const imageStr = String(part.image);
        if (imageStr.startsWith("data:")) {
          const match = imageStr.match(/^data:([^;]+);base64,(.*)$/);
          if (match && (!match[2] || match[2].length === 0)) {
            return {
              type: "text" as const,
              text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
            };
          }
        }
      }

      const mime =
        part.type === "image"
          ? String(part.image).split(";")[0].replace("data:", "")
          : part.mediaType;
      const filename = part.type === "file" ? part.filename : undefined;
      const modality = mimeToModality(mime);
      if (!modality) return part;
      if (model.capabilities.input[modality]) return part;

      const name = filename ? `"${filename}"` : modality;
      return {
        type: "text" as const,
        text: `ERROR: Cannot read ${name} (this model does not support ${modality} input). Inform the user.`,
      };
    });

    return { ...msg, content: filtered };
  });
}

function mapProviderOptions(
  msgs: ModelMessage[],
  transform: ProviderOptionsTransform,
) {
  return msgs.map((msg) => {
    if (!Array.isArray(msg.content))
      return { ...msg, providerOptions: transform(msg.providerOptions) };
    return {
      ...msg,
      providerOptions: transform(msg.providerOptions),
      content: msg.content.map((part) =>
        part.type === "tool-approval-request" ||
        part.type === "tool-approval-response"
          ? part
          : { ...part, providerOptions: transform(part.providerOptions) },
      ),
    } as typeof msg;
  });
}

export function message(
  msgs: ModelMessage[],
  model: Provider.Model,
  options: Record<string, unknown>,
) {
  msgs = unsupportedParts(msgs, model);
  msgs = normalizeMessages(msgs, model, options);
  if (
    (model.providerID === "anthropic" ||
      model.providerID === "google-vertex-anthropic" ||
      model.api.id.includes("anthropic") ||
      model.api.id.includes("claude") ||
      model.id.includes("anthropic") ||
      model.id.includes("claude") ||
      model.api.npm === "@ai-sdk/anthropic" ||
      model.api.npm === "@ai-sdk/alibaba") &&
    model.api.npm !== "@ai-sdk/gateway"
  ) {
    msgs = applyCaching(msgs, model);
  }

  // Remap providerOptions keys from stored providerID to expected SDK key
  const key = sdkKey(model.api.npm);
  if (key && key !== model.providerID) {
    const remap: ProviderOptionsTransform = (opts) => {
      if (!opts) return opts;
      if (!(model.providerID in opts)) return opts;
      const result = { ...opts };
      result[key] = result[model.providerID];
      delete result[model.providerID];
      return result;
    };

    msgs = mapProviderOptions(msgs, remap);
  }

  // Strip Responses item IDs before serialization, following Codex and keeping signed request bodies immutable.
  if (
    options.store !== true &&
    key &&
    [
      "@ai-sdk/openai",
      "@ai-sdk/azure",
      "@ai-sdk/amazon-bedrock/mantle",
      "@ai-sdk/github-copilot",
    ].includes(model.api.npm)
  ) {
    msgs = mapProviderOptions(msgs, (options) => {
      const metadata = options?.[key];
      if (!metadata || !("itemId" in metadata)) return options;
      const sanitized: JSONObject = { ...metadata };
      delete sanitized.itemId;
      return { ...options, [key]: sanitized };
    });
  }

  return msgs;
}

export function temperature(model: Provider.Model) {
  const id = model.id.toLowerCase();
  if (id.includes("north-mini-code")) return 1.0;
  if (id.includes("qwen")) return 0.55;
  if (id.includes("claude")) return undefined;
  if (id.includes("gemini")) return 1.0;
  if (id.includes("glm-4.6")) return 1.0;
  if (id.includes("glm-4.7")) return 1.0;
  if (id.includes("minimax-m2")) return 1.0;
  if (id.includes("kimi-k2")) {
    // kimi-k2-thinking & kimi-k2.5 && kimi-k2p5 && kimi-k2-5
    if (["thinking", "k2.", "k2p", "k2-5"].some((s) => id.includes(s))) {
      return 1.0;
    }
    return 0.6;
  }
  return undefined;
}

export function topP(model: Provider.Model) {
  const id = model.id.toLowerCase();
  if (id.includes("qwen")) return 1;
  if (
    ["minimax-m2", "gemini", "kimi-k2.5", "kimi-k2p5", "kimi-k2-5"].some((s) =>
      id.includes(s),
    )
  ) {
    return 0.95;
  }
  return undefined;
}

export function topK(model: Provider.Model) {
  const id = model.id.toLowerCase();
  if (id.includes("minimax-m2")) {
    if (["m2.", "m25", "m21"].some((s) => id.includes(s))) return 40;
    return 20;
  }
  if (id.includes("gemini")) return 64;
  return undefined;
}
