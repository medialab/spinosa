import type { CustomLoader } from "./loader";
import type { CustomDep } from "./custom-loaders-shared";
import {
  customAnthropic,
  customGithubCopilot,
  customOpencode,
  customOpenai,
  customXai,
} from "./custom-loaders-basic";
import {
  customAmazonBedrock,
  customAzure,
  customAzureCognitiveServices,
  customGoogleVertex,
  customGoogleVertexAnthropic,
  customSapAiCore,
  customZenmux,
} from "./custom-loaders-cloud";
import {
  customGitlab,
  customLlmgateway,
  customNvidia,
  customOpenrouter,
  customVercel,
} from "./custom-loaders-integrations";
import {
  customCerebras,
  customCloudflareAiGateway,
  customCloudflareWorkersAi,
  customKilo,
  customSnowflakeCortex,
} from "./custom-loaders-edge";

export function custom(dep: CustomDep): Record<string, CustomLoader> {
  return {
    anthropic: customAnthropic(dep),
    opencode: customOpencode(dep),
    openai: customOpenai(dep),
    xai: customXai(dep),
    "github-copilot": customGithubCopilot(dep),
    azure: customAzure(dep),
    "azure-cognitive-services": customAzureCognitiveServices(dep),
    "amazon-bedrock": customAmazonBedrock(dep),
    llmgateway: customLlmgateway(dep),
    openrouter: customOpenrouter(dep),
    nvidia: customNvidia(dep),
    vercel: customVercel(dep),
    "google-vertex": customGoogleVertex(dep),
    "google-vertex-anthropic": customGoogleVertexAnthropic(dep),
    "sap-ai-core": customSapAiCore(dep),
    zenmux: customZenmux(dep),
    gitlab: customGitlab(dep),
    "cloudflare-workers-ai": customCloudflareWorkersAi(dep),
    "cloudflare-ai-gateway": customCloudflareAiGateway(dep),
    cerebras: customCerebras(dep),
    kilo: customKilo(dep),
    "snowflake-cortex": customSnowflakeCortex(dep),
  };
}
