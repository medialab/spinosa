import { LayerNode } from "@spinosa/kernel-core/effect/layer-node";
import fuzzysort from "fuzzysort";
import { Config } from "@/config/config";
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda";
import { NoSuchModelError } from "ai";
import { Plugin } from "../plugin";
import { serviceUse } from "@spinosa/kernel-core/effect/service-use";
import { type LanguageModelV3 } from "@ai-sdk/provider";
import { ModelsDev } from "@spinosa/kernel-core/models-dev";
import { Auth } from "../auth";
import { Env } from "../env";
import { iife } from "@/util/iife";
import { Global } from "@spinosa/kernel-core/global";
import path from "path";
import { Effect, Layer, Context, Schema, Types } from "effect";
import { EffectBridge } from "@/effect/bridge";
import { InstanceState } from "@/effect/instance-state";
import { EffectPromise } from "@/effect/promise";
import { FSUtil } from "@spinosa/kernel-core/fs-util";
import { isRecord } from "@/util/record";
import { optional } from "@spinosa/kernel-core/schema";
import { ProviderTransform } from "./transform";
import { custom } from "./custom-loaders";
import { ProviderV2 } from "@spinosa/kernel-core/provider";
import { ModelV2 } from "@spinosa/kernel-core/model";
import { ModelStatus } from "./model-status";
import { RuntimeFlags } from "@/effect/runtime-flags";
import type { CustomDep } from "./custom-loaders-shared";
import {
  resolveProviderSDK,
  type BundledSDK,
  type CustomDiscoverModels,
  type CustomLoader,
  type CustomModelLoader,
  type CustomVarsLoader,
} from "./loader";

const ProviderApiInfo = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  npm: Schema.String,
});

const ProviderModalities = Schema.Struct({
  text: Schema.Boolean,
  audio: Schema.Boolean,
  image: Schema.Boolean,
  video: Schema.Boolean,
  pdf: Schema.Boolean,
});

const ProviderInterleaved = Schema.Union([
  Schema.Boolean,
  Schema.Struct({
    field: Schema.Literals([
      "reasoning",
      "reasoning_content",
      "reasoning_details",
    ]),
  }),
]);

const ProviderCapabilities = Schema.Struct({
  temperature: Schema.Boolean,
  reasoning: Schema.Boolean,
  attachment: Schema.Boolean,
  toolcall: Schema.Boolean,
  input: ProviderModalities,
  output: ProviderModalities,
  interleaved: ProviderInterleaved,
});

const ProviderCacheCost = Schema.Struct({
  read: Schema.Finite,
  write: Schema.Finite,
});

const ProviderCostTier = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache: ProviderCacheCost,
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Finite,
  }),
});

const ProviderCost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache: ProviderCacheCost,
  tiers: optional(Schema.Array(ProviderCostTier)),
  experimentalOver200K: optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache: ProviderCacheCost,
    }),
  ),
});

const ProviderLimit = Schema.Struct({
  context: Schema.Finite,
  input: optional(Schema.Finite),
  output: Schema.Finite,
});

export const Model = Schema.Struct({
  id: ModelV2.ID,
  providerID: ProviderV2.ID,
  api: ProviderApiInfo,
  name: Schema.String,
  family: optional(Schema.String),
  capabilities: ProviderCapabilities,
  cost: ProviderCost,
  limit: ProviderLimit,
  status: ModelStatus,
  options: Schema.Record(Schema.String, Schema.Any),
  headers: Schema.Record(Schema.String, Schema.String),
  release_date: Schema.String,
  variants: optional(
    Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Any)),
  ),
}).annotate({ identifier: "Model" });
export type Model = Types.DeepMutable<Schema.Schema.Type<typeof Model>>;

export const Info = Schema.Struct({
  id: ProviderV2.ID,
  name: Schema.String,
  source: Schema.Literals(["env", "config", "custom", "api"]),
  env: Schema.Array(Schema.String),
  key: optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Any),
  models: Schema.Record(Schema.String, Model),
}).annotate({ identifier: "Provider" });
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>;

const DefaultModelIDs = Schema.Record(Schema.String, Schema.String);

export const ListResult = Schema.Struct({
  all: Schema.Array(Info),
  default: DefaultModelIDs,
  connected: Schema.Array(Schema.String),
});
export type ListResult = Types.DeepMutable<
  Schema.Schema.Type<typeof ListResult>
>;

export const ConfigProvidersResult = Schema.Struct({
  providers: Schema.Array(Info),
  default: DefaultModelIDs,
});
export type ConfigProvidersResult = Types.DeepMutable<
  Schema.Schema.Type<typeof ConfigProvidersResult>
>;

export function toPublicInfo(provider: Info): Info {
  return JSON.parse(
    JSON.stringify(provider, (_, value) => {
      if (
        typeof value === "function" ||
        typeof value === "symbol" ||
        value === undefined
      )
        return undefined;
      if (typeof value === "bigint") return value.toString();
      return value;
    }),
  );
}

export function defaultModelIDs<
  T extends { models: Record<string, { id: string }> },
>(providers: Record<string, T>) {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(providers)) {
    // A catalog entry with zero models must not fail the whole list —
    // skip it so one malformed provider cannot 500 /provider and empty
    // the TUI connect dialog.
    const first = sort(Object.values(item.models))[0];
    if (first) result[key] = first.id;
  }
  return result;
}

export class ModelNotFoundError extends Schema.TaggedErrorClass<ModelNotFoundError>()(
  "ProviderModelNotFoundError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    suggestions: Schema.optional(Schema.Array(Schema.String)),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    const suggestions = this.suggestions?.length
      ? ` Did you mean: ${this.suggestions.join(", ")}?`
      : "";
    return `Model not found: ${this.providerID}/${this.modelID}.${suggestions}`;
  }

  static isInstance(input: unknown): input is ModelNotFoundError {
    return input instanceof ModelNotFoundError;
  }
}

export class InitError extends Schema.TaggedErrorClass<InitError>()(
  "ProviderInitError",
  {
    providerID: ProviderV2.ID,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return `Failed to initialize provider: ${this.providerID}`;
  }

  static isInstance(input: unknown): input is InitError {
    return input instanceof InitError;
  }
}

export class NoProvidersError extends Schema.TaggedErrorClass<NoProvidersError>()(
  "ProviderNoProvidersError",
  {},
) {
  override get message() {
    return "No providers are available";
  }

  static isInstance(input: unknown): input is NoProvidersError {
    return input instanceof NoProvidersError;
  }
}

export class NoModelsError extends Schema.TaggedErrorClass<NoModelsError>()(
  "ProviderNoModelsError",
  {
    providerID: ProviderV2.ID,
  },
) {
  override get message() {
    return `No models are available for provider: ${this.providerID}`;
  }

  static isInstance(input: unknown): input is NoModelsError {
    return input instanceof NoModelsError;
  }
}

export type DefaultModelError =
  | ModelNotFoundError
  | NoProvidersError
  | NoModelsError;
export type Error =
  | ModelNotFoundError
  | InitError
  | NoProvidersError
  | NoModelsError;

export interface Interface {
  readonly list: () => Effect.Effect<Record<ProviderV2.ID, Info>>;
  readonly reload: () => Effect.Effect<void>;
  readonly getProvider: (providerID: ProviderV2.ID) => Effect.Effect<Info>;
  readonly getModel: (
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
  ) => Effect.Effect<Model, ModelNotFoundError>;
  readonly getLanguage: (
    model: Model,
  ) => Effect.Effect<LanguageModelV3, ModelNotFoundError>;
  readonly closest: (
    providerID: ProviderV2.ID,
    query: string[],
  ) => Effect.Effect<
    { providerID: ProviderV2.ID; modelID: string } | undefined
  >;
  readonly getSmallModel: (
    providerID: ProviderV2.ID,
  ) => Effect.Effect<Model | undefined>;
  readonly defaultModel: () => Effect.Effect<
    { providerID: ProviderV2.ID; modelID: ModelV2.ID },
    DefaultModelError
  >;
}

interface State {
  models: Map<string, LanguageModelV3>;
  providers: Record<ProviderV2.ID, Info>;
  catalog: Record<ProviderV2.ID, Info>;
  sdk: Map<string, BundledSDK>;
  modelLoaders: Record<string, CustomModelLoader>;
  varsLoaders: Record<string, CustomVarsLoader>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@spinosa/Provider",
) {}

export const use = serviceUse(Service);

function cost(c: ModelsDev.Model["cost"]): Model["cost"] {
  const result: Model["cost"] = {
    input: c?.input ?? 0,
    output: c?.output ?? 0,
    cache: {
      read: c?.cache_read ?? 0,
      write: c?.cache_write ?? 0,
    },
  };
  if (c?.tiers) {
    result.tiers = c.tiers.map((item) => ({
      input: item.input,
      output: item.output,
      cache: {
        read: item.cache_read ?? 0,
        write: item.cache_write ?? 0,
      },
      tier: item.tier,
    }));
  }
  if (c?.context_over_200k) {
    result.experimentalOver200K = {
      cache: {
        read: c.context_over_200k.cache_read ?? 0,
        write: c.context_over_200k.cache_write ?? 0,
      },
      input: c.context_over_200k.input,
      output: c.context_over_200k.output,
    };
  }
  return result;
}

function fromModelsDevModel(
  provider: ModelsDev.Provider,
  model: ModelsDev.Model,
): Model {
  const base: Model = {
    id: ModelV2.ID.make(model.id),
    providerID: ProviderV2.ID.make(provider.id),
    name: model.name,
    family: model.family,
    api: {
      id: model.id,
      url: model.provider?.api ?? provider.api ?? "",
      npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
    },
    status: model.status ?? "active",
    headers: {},
    options: {},
    cost: cost(model.cost),
    limit: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output,
    },
    capabilities: {
      temperature: model.temperature ?? false,
      reasoning: model.reasoning ?? false,
      attachment: model.attachment ?? false,
      toolcall: model.tool_call ?? true,
      input: {
        text: model.modalities?.input?.includes("text") ?? false,
        audio: model.modalities?.input?.includes("audio") ?? false,
        image: model.modalities?.input?.includes("image") ?? false,
        video: model.modalities?.input?.includes("video") ?? false,
        pdf: model.modalities?.input?.includes("pdf") ?? false,
      },
      output: {
        text: model.modalities?.output?.includes("text") ?? false,
        audio: model.modalities?.output?.includes("audio") ?? false,
        image: model.modalities?.output?.includes("image") ?? false,
        video: model.modalities?.output?.includes("video") ?? false,
        pdf: model.modalities?.output?.includes("pdf") ?? false,
      },
      interleaved: model.interleaved ?? false,
    },
    release_date: model.release_date ?? "",
    variants: {},
  };

  return {
    ...base,
    variants: mapValues(ProviderTransform.variants(base), (v) => v),
  };
}

export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
  const models: Record<string, Model> = {};
  for (const [key, model] of Object.entries(provider.models)) {
    models[key] = fromModelsDevModel(provider, model);
    for (const [mode, opts] of Object.entries(
      model.experimental?.modes ?? {},
    )) {
      const id = `${model.id}-${mode}`;
      const base = fromModelsDevModel(provider, model);
      models[id] = {
        ...base,
        id: ModelV2.ID.make(id),
        name: `${model.name} ${mode[0].toUpperCase()}${mode.slice(1)}`,
        cost: opts.cost ? mergeDeep(base.cost, cost(opts.cost)) : base.cost,
        options: opts.provider?.body
          ? Object.fromEntries(
              Object.entries(opts.provider.body).map(([k, v]) => [
                k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
                v,
              ]),
            )
          : base.options,
        headers: opts.provider?.headers ?? base.headers,
      };
    }
  }
  return {
    id: ProviderV2.ID.make(provider.id),
    source: "custom",
    name: provider.name,
    env: [...(provider.env ?? [])],
    options: {},
    models,
  };
}

/**
 * Convert a raw models.dev catalog into provider records. One malformed
 * entry must never fail the whole provider list (which would empty the
 * TUI connect dialog), so bad entries are skipped and reported.
 */
export function buildCatalogProviders(input: {
  catalog: Record<string, ModelsDev.Provider>;
  onSkipped?: (providerID: string, error: unknown) => void;
}): { providers: Record<string, Info>; skipped: string[] } {
  const providers: Record<string, Info> = {};
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(input.catalog)) {
    try {
      providers[key] = fromModelsDevProvider(value);
    } catch (error) {
      skipped.push(key);
      input.onSkipped?.(key, error);
    }
  }
  return { providers, skipped };
}

function modelSuggestions(
  provider: Info | undefined,
  modelID: ModelV2.ID,
  enableExperimentalModels: boolean,
) {
  const available = provider
    ? Object.keys(provider.models).filter((id) => {
        const model = provider.models[id];
        if (model.status === "deprecated") return false;
        if (model.status === "alpha" && !enableExperimentalModels) return false;
        return true;
      })
    : [];
  const fuzzy = fuzzysort
    .go(modelID, available, { limit: 3, threshold: -10000 })
    .map((m) => m.target);
  if (fuzzy.length) return fuzzy;
  const query = modelID
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 1);
  return sortBy(
    available
      .map((id) => ({
        id,
        score: query.filter((part) => id.toLowerCase().includes(part)).length,
      }))
      .filter((item) => item.score > 0),
    [(item) => item.score, "desc"],
    [(item) => item.id, "asc"],
  )
    .slice(0, 3)
    .map((item) => item.id);
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service;
    const config = yield* Config.Service;
    const auth = yield* Auth.Service;
    const env = yield* Env.Service;
    const plugin = yield* Plugin.Service;
    const modelsDevSvc = yield* ModelsDev.Service;
    const runtimeFlags = yield* RuntimeFlags.Service;

    const state = yield* InstanceState.make<State>(() =>
      Effect.gen(function* () {
        const bridge = yield* EffectBridge.make();
        const cfg = yield* config.get();
        const modelsDev = yield* modelsDevSvc.get();
        const catalog = mapValues(modelsDev, fromModelsDevProvider);
        const database = mapValues(catalog, toPublicInfo);

        const providers: Record<ProviderV2.ID, Info> = {} as Record<
          ProviderV2.ID,
          Info
        >;
        const languages = new Map<string, LanguageModelV3>();
        const modelLoaders: {
          [providerID: string]: CustomModelLoader;
        } = {};
        const varsLoaders: {
          [providerID: string]: CustomVarsLoader;
        } = {};
        const sdk = new Map<string, BundledSDK>();
        const discoveryLoaders: {
          [providerID: string]: CustomDiscoverModels;
        } = {};
        const dep = {
          auth: (id: string) => auth.get(id).pipe(Effect.orDie),
          config: () => config.get(),
          env: () => env.all(),
          get: (key: string) => env.get(key),
        };

        function mergeProvider(
          providerID: ProviderV2.ID,
          provider: Partial<Info>,
        ) {
          const existing = providers[providerID];
          if (existing) {
            // @ts-expect-error
            providers[providerID] = mergeDeep(existing, provider);
            return;
          }
          const match = database[providerID];
          if (!match) return;
          // @ts-expect-error
          providers[providerID] = mergeDeep(match, provider);
        }

        // load plugins first so config() hook runs before reading cfg.provider
        const plugins = yield* plugin.list();

        // now read config providers - includes any modifications from plugin config() hook
        const configProviders = Object.entries(cfg.provider ?? {});
        const disabled = new Set(cfg.disabled_providers ?? []);
        const enabled = cfg.enabled_providers
          ? new Set(cfg.enabled_providers)
          : null;

        function isProviderAllowed(providerID: ProviderV2.ID): boolean {
          if (enabled && !enabled.has(providerID)) return false;
          if (disabled.has(providerID)) return false;
          return true;
        }

        for (const hook of plugins) {
          const p = hook.provider;
          const models = p?.models;
          if (!p || !models) continue;

          const providerID = ProviderV2.ID.make(p.id);
          if (disabled.has(providerID)) continue;

          const provider = database[providerID];
          if (!provider) continue;
          const pluginAuth = yield* auth.get(providerID).pipe(Effect.orDie);

          provider.models = yield* Effect.promise(async () => {
            const next = await models(toPublicInfo(provider), {
              auth: pluginAuth,
            });
            return Object.fromEntries(
              Object.entries(next).map(([id, model]) => [
                id,
                {
                  ...model,
                  id: ModelV2.ID.make(id),
                  providerID,
                },
              ]),
            );
          });
        }

        // extend database from config
        for (const [providerID, provider] of configProviders) {
          const existing = database[providerID];
          const parsed: Info = {
            id: ProviderV2.ID.make(providerID),
            name: provider.name ?? existing?.name ?? providerID,
            env: provider.env ?? existing?.env ?? [],
            options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
            source: "config",
            models: existing?.models ?? {},
          };

          for (const [modelID, model] of Object.entries(
            provider.models ?? {},
          )) {
            const existingModel = parsed.models[model.id ?? modelID];
            const apiID = model.id ?? existingModel?.api.id ?? modelID;
            const apiNpm =
              model.provider?.npm ??
              provider.npm ??
              existingModel?.api.npm ??
              modelsDev[providerID]?.npm ??
              "@ai-sdk/openai-compatible";
            const name = iife(() => {
              if (model.name) return model.name;
              if (model.id && model.id !== modelID) return modelID;
              return existingModel?.name ?? modelID;
            });
            const parsedModel: Model = {
              id: ModelV2.ID.make(modelID),
              api: {
                id: apiID,
                npm: apiNpm,
                url:
                  model.provider?.api ??
                  provider?.api ??
                  existingModel?.api.url ??
                  modelsDev[providerID]?.api ??
                  "",
              },
              status: model.status ?? existingModel?.status ?? "active",
              name,
              providerID: ProviderV2.ID.make(providerID),
              capabilities: {
                temperature:
                  model.temperature ??
                  existingModel?.capabilities.temperature ??
                  false,
                reasoning:
                  model.reasoning ??
                  existingModel?.capabilities.reasoning ??
                  false,
                attachment:
                  model.attachment ??
                  existingModel?.capabilities.attachment ??
                  false,
                toolcall:
                  model.tool_call ??
                  existingModel?.capabilities.toolcall ??
                  true,
                input: {
                  text:
                    model.modalities?.input?.includes("text") ??
                    existingModel?.capabilities.input.text ??
                    true,
                  audio:
                    model.modalities?.input?.includes("audio") ??
                    existingModel?.capabilities.input.audio ??
                    false,
                  image:
                    model.modalities?.input?.includes("image") ??
                    existingModel?.capabilities.input.image ??
                    false,
                  video:
                    model.modalities?.input?.includes("video") ??
                    existingModel?.capabilities.input.video ??
                    false,
                  pdf:
                    model.modalities?.input?.includes("pdf") ??
                    existingModel?.capabilities.input.pdf ??
                    false,
                },
                output: {
                  text:
                    model.modalities?.output?.includes("text") ??
                    existingModel?.capabilities.output.text ??
                    true,
                  audio:
                    model.modalities?.output?.includes("audio") ??
                    existingModel?.capabilities.output.audio ??
                    false,
                  image:
                    model.modalities?.output?.includes("image") ??
                    existingModel?.capabilities.output.image ??
                    false,
                  video:
                    model.modalities?.output?.includes("video") ??
                    existingModel?.capabilities.output.video ??
                    false,
                  pdf:
                    model.modalities?.output?.includes("pdf") ??
                    existingModel?.capabilities.output.pdf ??
                    false,
                },
                interleaved:
                  model.interleaved ??
                  existingModel?.capabilities.interleaved ??
                  (!existingModel &&
                  apiNpm === "@ai-sdk/openai-compatible" &&
                  apiID.includes("deepseek")
                    ? { field: "reasoning_content" }
                    : false),
              },
              cost: {
                input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
                output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
                cache: {
                  read:
                    model?.cost?.cache_read ??
                    existingModel?.cost?.cache.read ??
                    0,
                  write:
                    model?.cost?.cache_write ??
                    existingModel?.cost?.cache.write ??
                    0,
                },
              },
              options: mergeDeep(
                existingModel?.options ?? {},
                model.options ?? {},
              ),
              limit: {
                context:
                  model.limit?.context ?? existingModel?.limit?.context ?? 0,
                input: model.limit?.input ?? existingModel?.limit?.input,
                output:
                  model.limit?.output ?? existingModel?.limit?.output ?? 0,
              },
              headers: mergeDeep(
                existingModel?.headers ?? {},
                model.headers ?? {},
              ),
              family: model.family ?? existingModel?.family ?? "",
              release_date:
                model.release_date ?? existingModel?.release_date ?? "",
              variants: {},
            };
            const merged = mergeDeep(
              ProviderTransform.variants(parsedModel),
              model.variants ?? {},
            );
            parsedModel.variants = mapValues(
              pickBy(merged, (v) => !v.disabled),
              (v) => omit(v, ["disabled"]),
            );
            parsed.models[modelID] = parsedModel;
          }
          database[providerID] = parsed;
        }

        // load env
        const envs = yield* env.all();
        for (const [id, provider] of Object.entries(database)) {
          const providerID = ProviderV2.ID.make(id);
          if (disabled.has(providerID)) continue;
          const apiKey = provider.env.map((item) => envs[item]).find(Boolean);
          if (!apiKey) continue;
          mergeProvider(providerID, {
            source: "env",
            key: provider.env.length === 1 ? apiKey : undefined,
          });
        }

        // load apikeys
        const auths = yield* auth.all().pipe(Effect.orDie);
        for (const [id, provider] of Object.entries(auths)) {
          const providerID = ProviderV2.ID.make(id);
          if (disabled.has(providerID)) continue;
          if (provider.type === "api") {
            mergeProvider(providerID, {
              source: "api",
              key: provider.key,
            });
          }
          if (provider.type === "oauth") {
            mergeProvider(providerID, { source: "custom" });
          }
        }

        // plugin auth loader - database now has entries for config providers
        for (const plugin of plugins) {
          if (!plugin.auth) continue;
          const providerID = ProviderV2.ID.make(plugin.auth.provider);
          if (disabled.has(providerID)) continue;

          const stored = yield* auth.get(providerID).pipe(Effect.orDie);
          if (!stored) continue;
          if (!plugin.auth.loader) continue;

          const options = yield* Effect.promise(() =>
            plugin.auth!.loader!(
              () =>
                bridge.promise(auth.get(providerID).pipe(Effect.orDie)) as any,
              toPublicInfo(database[plugin.auth!.provider]),
            ),
          );
          const opts = options ?? {};
          const patch: Partial<Info> = providers[providerID]
            ? { options: opts }
            : { source: "custom", options: opts };
          mergeProvider(providerID, patch);
        }

        for (const [id, fn] of Object.entries(custom(dep))) {
          const providerID = ProviderV2.ID.make(id);
          if (disabled.has(providerID)) continue;
          const data = database[providerID];
          if (!data) {
            continue;
          }
          const result = yield* fn(data);
          if (result && (result.autoload || providers[providerID])) {
            if (result.getModel) modelLoaders[providerID] = result.getModel;
            if (result.vars) varsLoaders[providerID] = result.vars;
            if (result.discoverModels)
              discoveryLoaders[providerID] = result.discoverModels;
            const opts = result.options ?? {};
            const patch: Partial<Info> = providers[providerID]
              ? { options: opts }
              : { source: "custom", options: opts };
            mergeProvider(providerID, patch);
          }
        }

        // load config - re-apply with updated data
        for (const [id, provider] of configProviders) {
          const providerID = ProviderV2.ID.make(id);
          const partial: Partial<Info> = { source: "config" };
          if (provider.env) partial.env = provider.env;
          if (provider.name) partial.name = provider.name;
          if (provider.options) partial.options = provider.options;
          mergeProvider(providerID, partial);
        }

        const gitlab = ProviderV2.ID.make("gitlab");
        if (
          discoveryLoaders[gitlab] &&
          providers[gitlab] &&
          isProviderAllowed(gitlab)
        ) {
          yield* Effect.promise(async () => {
            try {
              const discovered = await discoveryLoaders[gitlab]();
              for (const [modelID, model] of Object.entries(discovered)) {
                if (!providers[gitlab].models[modelID]) {
                  providers[gitlab].models[modelID] = model;
                }
              }
            } catch (e) {}
          });
        }

        for (const [id, provider] of Object.entries(providers)) {
          const providerID = ProviderV2.ID.make(id);
          if (!isProviderAllowed(providerID)) {
            delete providers[providerID];
            continue;
          }

          const configProvider = cfg.provider?.[providerID];

          for (const [modelID, model] of Object.entries(provider.models)) {
            model.api.id = model.api.id ?? model.id ?? modelID;
            if (
              // These chat aliases are invalid for the special handling in the
              // built-in providers below, but custom providers may support them.
              (modelID === "gpt-5-chat-latest" &&
                (providerID === ProviderV2.ID.openai ||
                  providerID === ProviderV2.ID.githubCopilot ||
                  providerID === ProviderV2.ID.openrouter)) ||
              (providerID === ProviderV2.ID.openrouter &&
                modelID === "openai/gpt-5-chat")
            )
              delete provider.models[modelID];
            if (
              model.status === "alpha" &&
              !runtimeFlags.enableExperimentalModels
            )
              delete provider.models[modelID];
            if (model.status === "deprecated") delete provider.models[modelID];
            if (
              (configProvider?.blacklist &&
                configProvider.blacklist.includes(modelID)) ||
              (configProvider?.whitelist &&
                !configProvider.whitelist.includes(modelID))
            )
              delete provider.models[modelID];

            if (!model.variants || Object.keys(model.variants).length === 0) {
              model.variants = mapValues(
                ProviderTransform.variants(model),
                (v) => v,
              );
            }

            const configVariants = configProvider?.models?.[modelID]?.variants;
            if (configVariants && model.variants) {
              const merged = mergeDeep(model.variants, configVariants);
              model.variants = mapValues(
                pickBy(merged, (v) => !v.disabled),
                (v) => omit(v, ["disabled"]),
              );
            }
          }

          if (Object.keys(provider.models).length === 0) {
            delete providers[providerID];
            continue;
          }
        }

        return {
          models: languages,
          providers,
          catalog,
          sdk,
          modelLoaders,
          varsLoaders,
        };
      }),
    );

    const list = Effect.fn("Provider.list")(() =>
      InstanceState.use(state, (s) => s.providers),
    );
    const reload = Effect.fn("Provider.reload")(() =>
      InstanceState.invalidateAll(state),
    );

    const getProvider = Effect.fn("Provider.getProvider")(
      (providerID: ProviderV2.ID) =>
        InstanceState.use(state, (s) => s.providers[providerID]),
    );

    const getModel = Effect.fn("Provider.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
    ) {
      const s = yield* InstanceState.get(state);
      const provider = s.providers[providerID];
      if (!provider) {
        const catalogProvider = s.catalog[providerID];
        const suggestions = catalogProvider
          ? modelSuggestions(
              catalogProvider,
              modelID,
              runtimeFlags.enableExperimentalModels,
            )
          : fuzzysort
              .go(providerID, Object.keys({ ...s.catalog, ...s.providers }), {
                limit: 3,
                threshold: -10000,
              })
              .map((m) => m.target);
        return yield* new ModelNotFoundError({
          providerID,
          modelID,
          suggestions,
        });
      }

      const info = provider.models[modelID];
      if (!info) {
        const current = modelSuggestions(
          provider,
          modelID,
          runtimeFlags.enableExperimentalModels,
        );
        const suggestions = current.length
          ? current
          : modelSuggestions(
              s.catalog[providerID],
              modelID,
              runtimeFlags.enableExperimentalModels,
            );
        return yield* new ModelNotFoundError({
          providerID,
          modelID,
          suggestions,
        });
      }
      return info;
    });

    const getLanguage = Effect.fn("Provider.getLanguage")(function* (
      model: Model,
    ) {
      const s = yield* InstanceState.get(state);
      const envs = yield* env.all();
      const key = `${model.providerID}/${model.id}`;
      if (s.models.has(key)) return s.models.get(key)!;

      const provider = s.providers[model.providerID];
      return yield* EffectPromise.refineRejection(
        async () => {
          const sdk = await resolveProviderSDK(
            model,
            s,
            envs,
            (providerID, cause) => new InitError({ providerID, cause }),
          );
          const language = s.modelLoaders[model.providerID]
            ? await s.modelLoaders[model.providerID](
                sdk,
                model.api.id,
                {
                  ...provider.options,
                  ...model.options,
                },
                model,
              )
            : sdk.languageModel(model.api.id);
          s.models.set(key, language);
          return language;
        },
        (cause) =>
          cause instanceof NoSuchModelError
            ? new ModelNotFoundError({
                modelID: model.id,
                providerID: model.providerID,
                cause,
              })
            : undefined,
      );
    });

    const closest = Effect.fn("Provider.closest")(function* (
      providerID: ProviderV2.ID,
      query: string[],
    ) {
      const s = yield* InstanceState.get(state);
      const provider = s.providers[providerID];
      if (!provider) return undefined;
      for (const item of query) {
        for (const modelID of Object.keys(provider.models)) {
          if (modelID.includes(item)) return { providerID, modelID };
        }
      }
      return undefined;
    });

    const getSmallModel = Effect.fn("Provider.getSmallModel")(function* (
      providerID: ProviderV2.ID,
    ) {
      const cfg = yield* config.get();

      if (cfg.small_model) {
        const parsed = parseModel(cfg.small_model);
        return yield* getModel(parsed.providerID, parsed.modelID).pipe(
          Effect.catchTag("ProviderModelNotFoundError", () =>
            Effect.succeed(undefined),
          ),
        );
      }

      const s = yield* InstanceState.get(state);
      const provider = s.providers[providerID];
      if (!provider) return undefined;

      const experimental =
        yield* plugin.trigger<"experimental.provider.small_model">(
          "experimental.provider.small_model",
          { provider: toPublicInfo(provider) },
          { model: undefined },
        );
      if (experimental.model) {
        return {
          ...experimental.model,
          id: ModelV2.ID.make(experimental.model.id),
          providerID: ProviderV2.ID.make(experimental.model.providerID),
        };
      }

      // TODO: Remove these provider-specific assumptions once model syncing reliably reports available deployments.
      if (
        providerID === ProviderV2.ID.azure ||
        providerID === ProviderV2.ID.make("azure-cognitive-services")
      ) {
        return undefined;
      }

      const priority = providerID.startsWith("opencode")
        ? ["gpt-nano"]
        : providerID.startsWith("github-copilot")
          ? ["gpt-mini", ...smallModelFamilyPriority]
          : smallModelFamilyPriority;
      const models = sortBy(
        Object.values(provider.models),
        [(model) => model.release_date, "desc"],
        [(model) => model.id, "desc"],
      );
      for (const family of priority) {
        const candidates = models.filter((model) => model.family === family);
        if (providerID === ProviderV2.ID.amazonBedrock) {
          const crossRegionPrefixes = ["global.", "us.", "eu."];

          const globalMatch = candidates.find((model) =>
            model.id.startsWith("global."),
          );
          if (globalMatch) return globalMatch;

          const region = provider.options?.region;
          if (region) {
            const regionPrefix = region.split("-")[0];
            if (regionPrefix === "us" || regionPrefix === "eu") {
              const regionalMatch = candidates.find((model) =>
                model.id.startsWith(`${regionPrefix}.`),
              );
              if (regionalMatch) return regionalMatch;
            }
          }

          const unprefixed = candidates.find(
            (model) => !crossRegionPrefixes.some((p) => model.id.startsWith(p)),
          );
          if (unprefixed) return unprefixed;
          continue;
        }
        if (candidates[0]) return candidates[0];
      }

      return undefined;
    });

    const defaultModel = Effect.fn("Provider.defaultModel")(function* () {
      const cfg = yield* config.get();
      if (cfg.model) return parseModel(cfg.model);

      const s = yield* InstanceState.get(state);
      const recent = yield* fs
        .readJson(path.join(Global.Path.state, "model.json"))
        .pipe(
          Effect.map(
            (x): { providerID: ProviderV2.ID; modelID: ModelV2.ID }[] => {
              if (!isRecord(x) || !Array.isArray(x.recent)) return [];
              return x.recent.flatMap((item) => {
                if (!isRecord(item)) return [];
                if (typeof item.providerID !== "string") return [];
                if (typeof item.modelID !== "string") return [];
                return [
                  {
                    providerID: ProviderV2.ID.make(item.providerID),
                    modelID: ModelV2.ID.make(item.modelID),
                  },
                ];
              });
            },
          ),
          Effect.catch(() =>
            Effect.succeed(
              [] as { providerID: ProviderV2.ID; modelID: ModelV2.ID }[],
            ),
          ),
        );
      for (const entry of recent) {
        const provider = s.providers[entry.providerID];
        if (!provider) continue;
        if (!provider.models[entry.modelID]) continue;
        return { providerID: entry.providerID, modelID: entry.modelID };
      }

      const configured = Object.keys(cfg.provider ?? {});
      const provider = Object.values(s.providers).find(
        (p) => configured.length === 0 || configured.includes(p.id),
      );
      if (!provider) return yield* new NoProvidersError();
      const [model] = sort(Object.values(provider.models));
      if (!model) return yield* new NoModelsError({ providerID: provider.id });
      return {
        providerID: provider.id,
        modelID: model.id,
      };
    });

    return Service.of({
      list,
      reload,
      getProvider,
      getModel,
      getLanguage,
      closest,
      getSmallModel,
      defaultModel,
    });
  }),
);

const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"];
const smallModelFamilyPriority = ["gemini-flash", "gpt-nano", "claude-haiku"];
export function sort<T extends { id: string }>(models: T[]) {
  return sortBy(
    models,
    [
      (model) => priority.findIndex((filter) => model.id.includes(filter)),
      "desc",
    ],
    [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
    [(model) => model.id, "desc"],
  );
}

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/");
  return {
    providerID: ProviderV2.ID.make(providerID),
    modelID: ModelV2.ID.make(rest.join("/")),
  };
}

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    FSUtil.node,
    Config.node,
    Auth.node,
    Env.node,
    Plugin.node,
    ModelsDev.node,
    RuntimeFlags.node,
  ],
});

export * as Provider from "./provider";
