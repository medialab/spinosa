import os from "os";
import { Effect } from "effect";
import { InstallationVersion } from "@spinosa/kernel-core/installation/version";
import { iife } from "@/util/iife";
import {
  type BundledSDK,
  type CustomLoader,
  type ProviderOptions,
} from "./loader";
import type { Info } from "./provider";
import type { CustomDep } from "./custom-loaders-shared";
export function customCloudflareWorkersAi(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* (input: Info) {
    // When baseURL is already configured (e.g. corporate config routing through a proxy/gateway),
    // skip the account ID check because the URL is already fully specified.
    if (input.options?.baseURL) return { autoload: false };

    const auth = yield* dep.auth(input.id);
    const env = yield* dep.env();
    const accountId =
      env["CLOUDFLARE_ACCOUNT_ID"] ||
      (auth?.type === "api" ? auth.metadata?.accountId : undefined);
    if (!accountId)
      return {
        autoload: false,
        async getModel() {
          throw new Error(
            "CLOUDFLARE_ACCOUNT_ID is missing. Set it with: export CLOUDFLARE_ACCOUNT_ID=<your-account-id>",
          );
        },
      };

    const apiKey =
      env["CLOUDFLARE_API_KEY"] ||
      (auth?.type === "api" ? auth.key : undefined);

    return {
      autoload: !!apiKey,
      options: {
        apiKey,
        headers: {
          "User-Agent": `spinosa/${InstallationVersion} cloudflare-workers-ai (${os.platform()} ${os.release()}; ${os.arch()})`,
        },
      },
      async getModel(sdk: BundledSDK, modelID: string) {
        return sdk.languageModel(modelID);
      },
      vars(_options) {
        return {
          CLOUDFLARE_ACCOUNT_ID: accountId,
        };
      },
    };
  });
}

export function customCloudflareAiGateway(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* (input: Info) {
    // When baseURL is already configured (e.g. corporate config), skip the ID checks.
    if (input.options?.baseURL) return { autoload: false };

    const auth = yield* dep.auth(input.id);
    const env = yield* dep.env();
    const accountId =
      env["CLOUDFLARE_ACCOUNT_ID"] ||
      (auth?.type === "api" ? auth.metadata?.accountId : undefined);
    // The Cloudflare auth prompt stores this value as gatewayId metadata.
    const gateway =
      env["CLOUDFLARE_GATEWAY_ID"] ||
      (auth?.type === "api" ? auth.metadata?.gatewayId : undefined);

    if (!accountId || !gateway) {
      const missing = [
        !accountId ? "CLOUDFLARE_ACCOUNT_ID" : undefined,
        !gateway ? "CLOUDFLARE_GATEWAY_ID" : undefined,
      ].filter((x): x is string => Boolean(x));
      return {
        autoload: false,
        async getModel() {
          throw new Error(
            `${missing.join(" and ")} missing. Set with: ${missing.map((x) => `export ${x}=<value>`).join(" && ")}`,
          );
        },
      };
    }

    // Get API token from env or auth - required for authenticated gateways
    const apiToken =
      env["CLOUDFLARE_API_TOKEN"] ||
      env["CF_AIG_TOKEN"] ||
      (auth?.type === "api" ? auth.key : undefined);

    if (!apiToken) {
      throw new Error(
        "CLOUDFLARE_API_TOKEN (or CF_AIG_TOKEN) is required for Cloudflare AI Gateway. " +
          "Set it via environment variable or run `spinosa auth cloudflare-ai-gateway`.",
      );
    }

    // Use official ai-gateway-provider package (v2.x for AI SDK v5 compatibility)
    const { createAiGateway } = yield* Effect.promise(
      () => import("ai-gateway-provider"),
    );
    const { createUnified } = yield* Effect.promise(
      () => import("ai-gateway-provider/providers/unified"),
    );

    const metadata = iife(() => {
      if (input.options?.metadata) return input.options.metadata;
      try {
        return JSON.parse(input.options?.headers?.["cf-aig-metadata"]);
      } catch {
        return undefined;
      }
    });
    const opts = {
      metadata,
      cacheTtl: input.options?.cacheTtl,
      cacheKey: input.options?.cacheKey,
      skipCache: input.options?.skipCache,
      collectLog: input.options?.collectLog,
      headers: {
        "User-Agent": `spinosa/${InstallationVersion} cloudflare-ai-gateway (${os.platform()} ${os.release()}; ${os.arch()})`,
      },
    };

    const aigateway = createAiGateway({
      accountId,
      gateway,
      apiKey: apiToken,
      ...(Object.values(opts).some((v) => v !== undefined)
        ? { options: opts }
        : {}),
    });
    const unified = createUnified({ apiKey: apiToken });

    return {
      autoload: true,
      async getModel(
        _sdk: BundledSDK,
        modelID: string,
        _options?: ProviderOptions,
      ) {
        // Model IDs use Unified API format: provider/model (e.g., "anthropic/claude-sonnet-4-5")
        return aigateway(unified(modelID));
      },
      options: {},
    };
  });
}

export function customCerebras(dep: CustomDep): CustomLoader {
  return () =>
    Effect.succeed({
      autoload: false,
      options: {
        headers: {
          "X-Cerebras-3rd-Party-Integration": "spinosa",
        },
      },
    });
}

export function customKilo(dep: CustomDep): CustomLoader {
  return () =>
    Effect.succeed({
      autoload: false,
      options: {
        headers: {
          "HTTP-Referer": "https://github.com/medialab/spinosa",
          "X-Title": "spinosa",
        },
      },
    });
}

export function customSnowflakeCortex(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* (input: Info) {
    const env = yield* dep.env();
    const auth = yield* dep.auth(input.id);

    const account =
      env["SNOWFLAKE_ACCOUNT"] ??
      (auth?.type === "api" ? auth.metadata?.account : undefined) ??
      (auth?.type === "oauth" ? auth.accountId : undefined) ??
      input.options?.account;

    const envToken =
      env["SNOWFLAKE_CORTEX_TOKEN"] ?? env["SNOWFLAKE_CORTEX_PAT"];
    const apiKeyToken = auth?.type === "api" ? auth.key : undefined;
    const oauthToken = auth?.type === "oauth" ? auth.access : undefined;
    const configToken = input.options?.token ?? input.options?.apiKey;

    const token = envToken ?? apiKeyToken ?? oauthToken ?? configToken;

    if (!account || !token) {
      const missing = [
        !account && "SNOWFLAKE_ACCOUNT",
        !token && "SNOWFLAKE_CORTEX_TOKEN",
      ]
        .filter(Boolean)
        .join(", ");
      return {
        autoload: false,
        async getModel() {
          throw new Error(
            `Snowflake Cortex: missing credentials (${missing}). Provide a bearer token (OAuth, JWT, or PAT) via env var, spinosa auth, or provider options.`,
          );
        },
      };
    }

    const baseURL = `https://${account}.snowflakecomputing.com/api/v2/cortex/v1`;

    const options: ProviderOptions = { baseURL, apiKey: token };

    // Only skip provider-level fetch when the token is from OAuth with no override.
    // For OAuth tokens, the plugin auth loader's combined fetch handles
    // OAuth refresh + snowflake transformations in one place.
    // For env/config/API-key tokens, the provider fetch applies snowflake
    // transformations directly.
    const useOAuthHandler =
      oauthToken !== undefined &&
      envToken === undefined &&
      apiKeyToken === undefined &&
      configToken === undefined;
    if (!useOAuthHandler) {
      options.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body && typeof init.body === "string") {
          try {
            const body = JSON.parse(init.body);
            if ("max_tokens" in body) {
              body.max_completion_tokens = body.max_tokens;
              delete body.max_tokens;
              init = { ...init, body: JSON.stringify(body) };
            }
          } catch {}
        }

        const response = await fetch(url, init);

        if (!response.ok && response.status === 400) {
          try {
            const errorData = await response.clone().json();
            const errorMessage = String(
              errorData.message || errorData.error || "",
            );
            if (errorMessage.toLowerCase().includes("conversation complete")) {
              return new Response(
                JSON.stringify({
                  choices: [
                    {
                      finish_reason: "stop",
                      message: { content: "", role: "assistant" },
                    },
                  ],
                }),
                {
                  status: 200,
                  headers: new Headers({
                    "content-type": "application/json",
                  }),
                },
              );
            }
          } catch {}
        }

        if (
          response.body &&
          response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          const reader = response.body.getReader();
          const encoder = new TextEncoder();
          const decoder = new TextDecoder();
          const stream = new ReadableStream({
            async pull(ctrl) {
              const { done, value } = await reader.read();
              if (done) {
                ctrl.close();
                return;
              }
              const text = decoder.decode(value, { stream: true });
              ctrl.enqueue(
                encoder.encode(
                  text.replace(/"role"\s*:\s*""/g, '"role":"assistant"'),
                ),
              );
            },
            cancel() {
              reader.cancel();
            },
          });
          return new Response(stream, {
            headers: response.headers,
            status: response.status,
          });
        }

        return response;
      };
    }

    return {
      autoload: input.source === "config",
      options,
    };
  });
}
