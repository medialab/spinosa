/**
 * Legacy opencode V1 client *type* bridge.
 *
 * These shapes are the app's internal domain model (the compat layer in
 * `server-compat.ts` converts live Spinosa SDK responses into them at
 * runtime). Declarations are vendored verbatim from the opencode
 * `opencode-ai-client` promise bundle so every consumer keeps compiling
 * without logic changes. No runtime imports from this module — the live
 * backend is `@spinosa/sdk` (see `server.ts`).
 */
export type {
  AgentApi,
  AgentListInput,
  AgentListOutput,
  CatalogApi,
  CommandApi,
  CommandInfo,
  CommandListInput,
  CommandListOutput,
  FileDiffInfo,
  IntegrationMethod,
  IntegrationOauthConnectOutput,
  McpListInput,
  McpListOutput,
  McpResource,
  McpResourceCatalogInput,
  McpResourceCatalogOutput,
  McpServer,
  ModelDefaultOutput,
  ModelListOutput,
  OpenCodeClient,
  OpenCodeEvent,
  PermissionV2Request,
  Project,
  ProjectCurrent,
  ProjectCurrentInput,
  ProjectCurrentOutput,
  ProjectListOutput,
  ProviderListOutput,
  ReferenceApi,
  ReferenceListInput,
  ReferenceListOutput,
  SessionActiveOutput,
  SessionApi,
  SessionCommandInput,
  SessionCommandOutput,
  SessionCompactInput,
  SessionCompactOutput,
  SessionInfo,
  SessionListInput,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageUser,
  SessionPendingMessage,
  SessionPromptInput,
  SessionPromptOutput,
  SessionShellInput,
  SessionShellOutput,
} from "../vendor-legacy-client/promise/index.js"
