import { Effect } from "effect";
import { iife } from "@/util/iife";
import {
  googleVertexAnthropicBaseURL,
  invokeLanguageModel,
  type BundledSDK,
  type CustomLoader,
  type ProviderOptions,
} from "./loader";
import type { Info, Model } from "./provider";
import type { CustomDep } from "./custom-loaders-shared";
function selectAzureLanguageModel(
  sdk: BundledSDK,
  modelID: string,
  useChat: boolean,
) {
  if (useChat && sdk.chat) return sdk.chat(modelID);
  if (sdk.responses) return sdk.responses(modelID);
  if (sdk.messages) return sdk.messages(modelID);
  if (sdk.chat) return sdk.chat(modelID);
  return sdk.languageModel(modelID);
}

function selectBedrockMantleLanguageModel(sdk: BundledSDK, modelID: string) {
  if (
    modelID === "openai.gpt-oss-safeguard-20b" ||
    modelID === "openai.gpt-oss-safeguard-120b"
  ) {
    return sdk.chat?.(modelID) ?? sdk.languageModel(modelID);
  }
  return sdk.responses?.(modelID) ?? sdk.languageModel(modelID);
}
export function customAzure(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* (provider: Info) {
    const env = yield* dep.env();
    const auth = yield* dep.auth(provider.id);
    const resource = iife(() => {
      return [
        provider.options?.resourceName,
        auth?.type === "api" ? auth.metadata?.resourceName : undefined,
        env["AZURE_RESOURCE_NAME"],
      ].find((name) => typeof name === "string" && name.trim() !== "");
    });

    if (!resource && !provider.options?.baseURL) {
      return {
        autoload: false,
        async getModel() {
          throw new Error(
            "AZURE_RESOURCE_NAME is missing, set it using env var or reconnecting the azure provider and setting it",
          );
        },
      };
    }

    return {
      autoload: false,
      async getModel(
        sdk: BundledSDK,
        modelID: string,
        options?: ProviderOptions,
      ) {
        return selectAzureLanguageModel(
          sdk,
          modelID,
          Boolean(options?.["useCompletionUrls"]),
        );
      },
      options: {
        resourceName: resource,
      },
      vars(_options): Record<string, string> {
        if (resource) {
          return {
            AZURE_RESOURCE_NAME: resource,
          };
        }
        return {};
      },
    };
  });
}

export function customAzureCognitiveServices(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* () {
    const resourceName = yield* dep.get(
      "AZURE_COGNITIVE_SERVICES_RESOURCE_NAME",
    );
    return {
      autoload: false,
      async getModel(
        sdk: BundledSDK,
        modelID: string,
        options?: ProviderOptions,
      ) {
        return selectAzureLanguageModel(
          sdk,
          modelID,
          Boolean(options?.["useCompletionUrls"]),
        );
      },
      options: {
        baseURL: resourceName
          ? `https://${resourceName}.cognitiveservices.azure.com/openai`
          : undefined,
      },
    };
  });
}

export function customAmazonBedrock(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* () {
    const providerConfig = (yield* dep.config()).provider?.["amazon-bedrock"];
    const auth = yield* dep.auth("amazon-bedrock");
    const env = yield* dep.env();

    // Region precedence: 1) config file, 2) env var, 3) default
    const configRegion = providerConfig?.options?.region;
    const envRegion = env["AWS_REGION"];
    const defaultRegion = configRegion ?? envRegion ?? "us-east-1";

    // Profile: config file takes precedence over env var
    const configProfile = providerConfig?.options?.profile;
    const envProfile = env["AWS_PROFILE"];
    const profile = configProfile ?? envProfile;

    const awsAccessKeyId = env["AWS_ACCESS_KEY_ID"];
    const configApiKey = providerConfig?.options?.apiKey;

    // TODO: Using process.env directly because Env.set only updates a process.env shallow copy,
    // until the scope of the Env API is clarified (test only or runtime?)
    const awsBearerToken = iife(() => {
      const envToken = process.env.AWS_BEARER_TOKEN_BEDROCK;
      if (envToken) return envToken;
      if (auth?.type === "api") {
        process.env.AWS_BEARER_TOKEN_BEDROCK = auth.key;
        return auth.key;
      }
      return undefined;
    });

    const awsWebIdentityTokenFile = env["AWS_WEB_IDENTITY_TOKEN_FILE"];

    const containerCreds = Boolean(
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
        process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI,
    );

    if (
      !profile &&
      !awsAccessKeyId &&
      !awsBearerToken &&
      !configApiKey &&
      !awsWebIdentityTokenFile &&
      !containerCreds
    )
      return { autoload: false };

    const { fromNodeProviderChain } = yield* Effect.promise(
      () => import("@aws-sdk/credential-providers"),
    );

    const providerOptions: ProviderOptions = {
      region: defaultRegion,
    };

    // Only use credential chain if no bearer token exists
    // Bearer token takes precedence over credential chain (profiles, access keys, IAM roles, web identity tokens)
    if (!awsBearerToken && !configApiKey) {
      // Build credential provider options (only pass profile if specified)
      const credentialProviderOptions = profile ? { profile } : {};

      providerOptions.credentialProvider = fromNodeProviderChain(
        credentialProviderOptions,
      );
    }

    // Add custom endpoint if specified (endpoint takes precedence over baseURL)
    const endpoint =
      providerConfig?.options?.endpoint ?? providerConfig?.options?.baseURL;
    if (endpoint) {
      providerOptions.baseURL = endpoint;
    }

    return {
      autoload: true,
      options: providerOptions,
      vars(options: ProviderOptions) {
        return { AWS_REGION: options.region ?? defaultRegion };
      },
      async getModel(
        sdk: BundledSDK,
        modelID: string,
        options?: ProviderOptions,
        model?: Model,
      ) {
        if (model?.api.npm === "@ai-sdk/amazon-bedrock/mantle")
          return selectBedrockMantleLanguageModel(sdk, modelID);

        // Skip region prefixing if model already has a cross-region inference profile prefix
        // Models from models.dev may already include prefixes like us., eu., global., etc.
        const crossRegionPrefixes = [
          "global.",
          "us.",
          "eu.",
          "jp.",
          "apac.",
          "au.",
        ];
        if (crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))) {
          return sdk.languageModel(modelID);
        }

        // Region resolution precedence (highest to lowest):
        // 1. options.region from spinosa.json provider config
        // 2. defaultRegion from AWS_REGION environment variable
        // 3. Default "us-east-1" (baked into defaultRegion)
        const region = options?.region ?? defaultRegion;

        let regionPrefix = region.split("-")[0];

        switch (regionPrefix) {
          case "us": {
            const modelRequiresPrefix = [
              "nova-micro",
              "nova-lite",
              "nova-pro",
              "nova-premier",
              "nova-2",
              "claude",
              "deepseek",
            ].some((m) => modelID.includes(m));
            const isGovCloud = region.startsWith("us-gov");
            if (modelRequiresPrefix && !isGovCloud) {
              modelID = `${regionPrefix}.${modelID}`;
            }
            break;
          }
          case "eu": {
            const regionRequiresPrefix = [
              "eu-west-1",
              "eu-west-2",
              "eu-west-3",
              "eu-north-1",
              "eu-central-1",
              "eu-south-1",
              "eu-south-2",
            ].some((r) => region.includes(r));
            const modelRequiresPrefix = [
              "claude",
              "nova-lite",
              "nova-micro",
              "llama3",
              "pixtral",
            ].some((m) => modelID.includes(m));
            if (regionRequiresPrefix && modelRequiresPrefix) {
              modelID = `${regionPrefix}.${modelID}`;
            }
            break;
          }
          case "ap": {
            const isAustraliaRegion = [
              "ap-southeast-2",
              "ap-southeast-4",
            ].includes(region);
            const isTokyoRegion = region === "ap-northeast-1";
            if (
              isAustraliaRegion &&
              ["anthropic.claude-sonnet-4-5", "anthropic.claude-haiku"].some(
                (m) => modelID.includes(m),
              )
            ) {
              regionPrefix = "au";
              modelID = `${regionPrefix}.${modelID}`;
            } else if (isTokyoRegion) {
              // Tokyo region uses jp. prefix for cross-region inference
              const modelRequiresPrefix = [
                "claude",
                "nova-lite",
                "nova-micro",
                "nova-pro",
              ].some((m) => modelID.includes(m));
              if (modelRequiresPrefix) {
                regionPrefix = "jp";
                modelID = `${regionPrefix}.${modelID}`;
              }
            } else {
              // Other APAC regions use apac. prefix
              const modelRequiresPrefix = [
                "claude",
                "nova-lite",
                "nova-micro",
                "nova-pro",
              ].some((m) => modelID.includes(m));
              if (modelRequiresPrefix) {
                regionPrefix = "apac";
                modelID = `${regionPrefix}.${modelID}`;
              }
            }
            break;
          }
        }

        return sdk.languageModel(modelID);
      },
    };
  });
}

export function customGoogleVertex(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* (provider: Info) {
    const env = yield* dep.env();
    // models.dev advertises GOOGLE_VERTEX_PROJECT for Vertex; keep the wider
    // Google Cloud project env names as fallbacks for existing ADC setups.
    const project =
      provider.options?.project ??
      env["GOOGLE_VERTEX_PROJECT"] ??
      env["GOOGLE_CLOUD_PROJECT"] ??
      env["GCP_PROJECT"] ??
      env["GCLOUD_PROJECT"];

    const location = String(
      provider.options?.location ??
        env["GOOGLE_VERTEX_LOCATION"] ??
        env["GOOGLE_CLOUD_LOCATION"] ??
        env["VERTEX_LOCATION"] ??
        "us-central1",
    );

    const autoload = Boolean(project);
    if (!autoload) return { autoload: false };
    return {
      autoload: true,
      vars(_options: ProviderOptions) {
        const endpoint =
          location === "global"
            ? "aiplatform.googleapis.com"
            : `${location}-aiplatform.googleapis.com`;
        return {
          ...(project && { GOOGLE_VERTEX_PROJECT: project }),
          GOOGLE_VERTEX_LOCATION: location,
          GOOGLE_VERTEX_ENDPOINT: endpoint,
        };
      },
      options: {
        project,
        location,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const { GoogleAuth } = await import("google-auth-library");
          const auth = new GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
          });
          const client = await auth.getClient();
          const token = await client.getAccessToken();

          const headers = new Headers(init?.headers);
          headers.set("Authorization", `Bearer ${token.token}`);

          return fetch(input, { ...init, headers });
        },
      },
      async getModel(sdk: BundledSDK, modelID: string) {
        const id = String(modelID).trim();
        return sdk.languageModel(id);
      },
    };
  });
}

export function customGoogleVertexAnthropic(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* () {
    const env = yield* dep.env();
    const project =
      env["GOOGLE_CLOUD_PROJECT"] ??
      env["GCP_PROJECT"] ??
      env["GCLOUD_PROJECT"];
    const location =
      env["GOOGLE_CLOUD_LOCATION"] ?? env["VERTEX_LOCATION"] ?? "global";
    const autoload = Boolean(project);
    if (!autoload) return { autoload: false };
    const baseURL = googleVertexAnthropicBaseURL(project, location);
    return {
      autoload: true,
      options: {
        project,
        location,
        ...(baseURL && { baseURL }),
      },
      async getModel(sdk: BundledSDK, modelID: string) {
        const id = String(modelID).trim();
        return sdk.languageModel(id);
      },
    };
  });
}

export function customSapAiCore(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* () {
    const auth = yield* dep.auth("sap-ai-core");
    // TODO: Using process.env directly because Env.set only updates a shallow copy (not process.env),
    // until the scope of the Env API is clarified (test only or runtime?)
    const envServiceKey = iife(() => {
      const envAICoreServiceKey = process.env.AICORE_SERVICE_KEY;
      if (envAICoreServiceKey) return envAICoreServiceKey;
      if (auth?.type === "api") {
        process.env.AICORE_SERVICE_KEY = auth.key;
        return auth.key;
      }
      return undefined;
    });
    const deploymentId = process.env.AICORE_DEPLOYMENT_ID;
    const resourceGroup = process.env.AICORE_RESOURCE_GROUP;

    return {
      autoload: !!envServiceKey,
      options: envServiceKey ? { deploymentId, resourceGroup } : {},
      async getModel(sdk: BundledSDK, modelID: string) {
        return invokeLanguageModel(sdk, modelID);
      },
    };
  });
}

export function customZenmux(dep: CustomDep): CustomLoader {
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
