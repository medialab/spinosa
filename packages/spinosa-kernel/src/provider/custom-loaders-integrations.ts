import os from "os";
import { Effect } from "effect";
import { InstallationVersion } from "@spinosa/kernel-core/installation/version";
import { InstanceState } from "@/effect/instance-state";
import { ModelV2 } from "@spinosa/kernel-core/model";
import { ProviderV2 } from "@spinosa/kernel-core/provider";
import {
  type BundledSDK,
  type CustomLoader,
  type ProviderOptions,
} from "./loader";
import type { Info, Model } from "./provider";
import type { CustomDep } from "./custom-loaders-shared";
export function customLlmgateway(dep: CustomDep): CustomLoader {
  return () =>
    Effect.succeed({
      autoload: false,
      options: {
        headers: {
          "HTTP-Referer": "https://github.com/medialab/spinosa",
          "X-Title": "spinosa",
          "X-Source": "spinosa",
        },
      },
    });
}

export function customOpenrouter(dep: CustomDep): CustomLoader {
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

export function customNvidia(dep: CustomDep): CustomLoader {
  return (provider) =>
    Effect.succeed({
      autoload: provider.source === "config",
      options: {
        headers: {
          "HTTP-Referer": "https://github.com/medialab/spinosa",
          "X-Title": "spinosa",
          "X-BILLING-INVOKE-ORIGIN": "Spinosa",
        },
      },
    });
}

export function customVercel(dep: CustomDep): CustomLoader {
  return () =>
    Effect.succeed({
      autoload: false,
      options: {
        headers: {
          "http-referer": "https://github.com/medialab/spinosa",
          "x-title": "spinosa",
        },
      },
    });
}

export function customGitlab(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* (input: Info) {
    const {
      VERSION: GITLAB_PROVIDER_VERSION,
      isWorkflowModel,
      discoverWorkflowModels,
    } = yield* Effect.promise(() => import("gitlab-ai-provider"));

    const instanceUrl =
      (yield* dep.get("GITLAB_INSTANCE_URL")) || "https://gitlab.com";

    const auth = yield* dep.auth(input.id);
    const apiKey =
      auth?.type === "oauth"
        ? auth.access
        : auth?.type === "api"
          ? auth.key
          : undefined;
    const token = apiKey ?? (yield* dep.get("GITLAB_TOKEN"));

    const providerConfig = (yield* dep.config()).provider?.["gitlab"];
    const directory = yield* InstanceState.directory;

    const aiGatewayHeaders = {
      "User-Agent": `spinosa/${InstallationVersion} gitlab-ai-provider/${GITLAB_PROVIDER_VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
      "anthropic-beta": "context-1m-2025-08-07",
      ...providerConfig?.options?.aiGatewayHeaders,
    };

    const featureFlags = {
      duo_agent_platform_agentic_chat: true,
      duo_agent_platform: true,
      ...providerConfig?.options?.featureFlags,
    };

    return {
      autoload: !!token,
      options: {
        instanceUrl,
        apiKey: token,
        aiGatewayHeaders,
        featureFlags,
      },
      async getModel(
        sdk: BundledSDK,
        modelID: string,
        options?: ProviderOptions,
      ) {
        if (modelID.startsWith("duo-workflow-")) {
          const workflowRef =
            typeof options?.workflowRef === "string"
              ? options.workflowRef
              : undefined;
          // Use the static mapping if it exists, otherwise use duo-workflow with selectedModelRef
          const sdkModelID = isWorkflowModel(modelID)
            ? modelID
            : "duo-workflow";
          const workflowDefinition =
            typeof options?.workflowDefinition === "string"
              ? options.workflowDefinition
              : undefined;
          if (!sdk.workflowChat)
            throw new Error("GitLab provider does not expose workflowChat");
          const model = sdk.workflowChat(sdkModelID, {
            featureFlags,
            workflowDefinition,
          });
          if (workflowRef) {
            model.selectedModelRef = workflowRef;
          }
          return model;
        }
        if (!sdk.agenticChat)
          throw new Error("GitLab provider does not expose agenticChat");
        return sdk.agenticChat(modelID, {
          aiGatewayHeaders,
          featureFlags,
        });
      },
      async discoverModels(): Promise<Record<string, Model>> {
        if (!apiKey) {
          return {};
        }

        try {
          const token = apiKey;
          const getHeaders = (): Record<string, string> =>
            auth?.type === "api"
              ? { "PRIVATE-TOKEN": token }
              : { Authorization: `Bearer ${token}` };

          const result = await discoverWorkflowModels(
            { instanceUrl, getHeaders },
            { workingDirectory: directory },
          );

          if (!result.models.length) {
            return {};
          }

          const models: Record<string, Model> = {};
          for (const m of result.models) {
            if (!input.models[m.id]) {
              models[m.id] = {
                id: ModelV2.ID.make(m.id),
                providerID: ProviderV2.ID.make("gitlab"),
                name: `Agent Platform (${m.name})`,
                family: "",
                api: {
                  id: m.id,
                  url: instanceUrl,
                  npm: "gitlab-ai-provider",
                },
                status: "active",
                headers: {},
                options: { workflowRef: m.ref },
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: m.context, output: m.output },
                capabilities: {
                  temperature: false,
                  reasoning: true,
                  attachment: true,
                  toolcall: true,
                  input: {
                    text: true,
                    audio: false,
                    image: true,
                    video: false,
                    pdf: true,
                  },
                  output: {
                    text: true,
                    audio: false,
                    image: false,
                    video: false,
                    pdf: false,
                  },
                  interleaved: false,
                },
                release_date: "",
                variants: {},
              };
            }
          }

          return models;
        } catch (e) {
          return {};
        }
      },
    };
  });
}
