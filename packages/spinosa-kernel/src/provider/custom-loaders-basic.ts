import { Effect } from "effect";
import { iife } from "@/util/iife";
import {
  type BundledSDK,
  type CustomLoader,
  type ProviderOptions,
} from "./loader";
import type { Info } from "./provider";
import type { CustomDep } from "./custom-loaders-shared";

const OPENAI_HEADER_TIMEOUT_DEFAULT = 10_000;
export function customAnthropic(dep: CustomDep): CustomLoader {
  return () =>
    Effect.succeed({
      autoload: false,
      options: {
        headers: {
          "anthropic-beta":
            "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
        },
      },
    });
}

/** Keep models that are free to run without an OpenCode key. Missing cost is free. */
export function keepFreeOpencodeModels(
  models: Record<string, { cost?: { input?: number } }>,
): void {
  for (const [key, value] of Object.entries(models)) {
    if ((value.cost?.input ?? 0) === 0) continue;
    delete models[key];
  }
}

export function customOpencode(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* (input: Info) {
    const env = yield* dep.env();
    const hasKey = iife(() => {
      if (input.env.some((item) => env[item])) return true;
      return false;
    });
    const ok =
      hasKey ||
      Boolean(yield* dep.auth(input.id)) ||
      Boolean((yield* dep.config()).provider?.["opencode"]?.options?.apiKey);

    if (!ok) keepFreeOpencodeModels(input.models);

    return {
      autoload: Object.keys(input.models).length > 0,
      options: ok ? {} : { apiKey: "public" },
    };
  });
}

export function customOpenai(dep: CustomDep): CustomLoader {
  return () =>
    Effect.succeed({
      autoload: false,
      async getModel(
        sdk: BundledSDK,
        modelID: string,
        _options?: ProviderOptions,
      ) {
        return sdk.responses?.(modelID) ?? sdk.languageModel(modelID);
      },
      options: { headerTimeout: OPENAI_HEADER_TIMEOUT_DEFAULT },
    });
}

export function customXai(dep: CustomDep): CustomLoader {
  return () =>
    Effect.succeed({
      autoload: false,
      async getModel(
        sdk: BundledSDK,
        modelID: string,
        _options?: ProviderOptions,
      ) {
        return sdk.responses?.(modelID) ?? sdk.languageModel(modelID);
      },
      options: {},
    });
}

export function customGithubCopilot(dep: CustomDep): CustomLoader {
  return () =>
    Effect.succeed({
      autoload: false,
      async getModel(
        sdk: BundledSDK,
        modelID: string,
        _options?: ProviderOptions,
      ) {
        if (sdk.responses === undefined && sdk.chat === undefined)
          return sdk.languageModel(modelID);
        const match = /^gpt-(\d+)/.exec(modelID);
        if (
          match &&
          Number(match[1]) >= 5 &&
          !modelID.startsWith("gpt-5-mini")
        ) {
          return sdk.responses?.(modelID) ?? sdk.languageModel(modelID);
        }
        return sdk.chat?.(modelID) ?? sdk.languageModel(modelID);
      },
      options: {},
    });
}
