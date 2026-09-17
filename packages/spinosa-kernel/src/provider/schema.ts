import type { JSONSchema7, SharedV3ProviderOptions } from "@ai-sdk/provider";
import type * as Provider from "./provider";
import {
  INCLUDE_ENCRYPTED_REASONING,
  OUTPUT_TOKEN_MAX,
  type JsonRecord,
  isPlainObject,
  sdkKey,
} from "./message-normalize";
import type { ProviderJsonObject } from "./json";
import { toJsonObject } from "./json";

const SLUG_OVERRIDES: Record<string, string> = {
  amazon: "bedrock",
};

export function providerOptions(
  model: Provider.Model,
  options: Record<string, unknown>,
): SharedV3ProviderOptions {
  const usesOpenAIReasoningGate =
    model.api.npm === "@ai-sdk/openai" ||
    model.api.npm === "@ai-sdk/azure" ||
    model.api.npm === "@ai-sdk/amazon-bedrock/mantle";
  const normalized =
    usesOpenAIReasoningGate &&
    (model.capabilities.reasoning ||
      options.reasoningEffort !== undefined ||
      options.reasoningSummary !== undefined)
      ? { ...options, forceReasoning: true }
      : options;
  const normalizedJson = toJsonObject(normalized);

  if (model.api.npm === "@ai-sdk/gateway") {
    // Gateway providerOptions are split across two namespaces:
    // - `gateway`: gateway-native routing/caching controls (order, only, byok, etc.)
    // - `<upstream slug>`: provider-specific model options (anthropic/openai/...)
    // We keep `gateway` as-is and route every other top-level option under the
    // model-derived upstream slug.
    const i = model.api.id.indexOf("/");
    const rawSlug = i > 0 ? model.api.id.slice(0, i) : undefined;
    const slug = rawSlug ? (SLUG_OVERRIDES[rawSlug] ?? rawSlug) : undefined;
    const gateway = normalizedJson.gateway;
    const rest: ProviderJsonObject = {};
    for (const [key, value] of Object.entries(normalizedJson)) {
      if (key !== "gateway") rest[key] = value;
    }
    const has = Object.keys(rest).length > 0;

    const result: SharedV3ProviderOptions = {};
    if (gateway !== undefined && isPlainObject(gateway))
      result.gateway = toJsonObject(gateway);

    if (has) {
      if (slug) {
        // Route model-specific options under the provider slug
        result[slug] = rest;
      } else if (gateway && isPlainObject(gateway)) {
        result.gateway = { ...toJsonObject(gateway), ...rest };
      } else {
        result.gateway = rest;
      }
    }

    return result;
  }

  // AI SDK packages that resolve providerOptionsName by splitting the
  // provider name on "." (e.g. "wafer.ai" -> "wafer") need the same
  // logic here so the key we write matches the key they read.
  // Other SDKs (xai, mistral, groq, cohere, etc.) use hardcoded keys
  // like "xai" or "cohere" - applying .split(".")[0] would break those.
  const usesDotSplitOptions =
    model.api.npm === "@ai-sdk/openai-compatible" ||
    model.api.npm === "@ai-sdk/openai" ||
    model.api.npm === "@ai-sdk/anthropic";
  const key =
    sdkKey(model.api.npm) ??
    (usesDotSplitOptions ? model.providerID.split(".")[0] : model.providerID);
  // @ai-sdk/azure delegates to OpenAIChatLanguageModel which reads from
  // providerOptions["openai"], but OpenAIResponsesLanguageModel checks
  // "azure" first. Pass both so model options work on either code path.
  if (model.api.npm === "@ai-sdk/azure") {
    return { openai: normalizedJson, azure: normalizedJson };
  }
  return { [key]: normalizedJson };
}

export function maxOutputTokens(
  model: Provider.Model,
  outputTokenMax = OUTPUT_TOKEN_MAX,
): number {
  return Math.min(model.limit.output, outputTokenMax) || outputTokenMax;
}

type SchemaWalker = (value: unknown) => unknown;
type SchemaObjectVisitor = (value: JsonRecord, walk: SchemaWalker) => unknown;

function walkSchema(
  value: unknown,
  visitObject: SchemaObjectVisitor,
  visitPrimitive: (value: unknown) => unknown = identity,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => walkSchema(item, visitObject, visitPrimitive));
  if (!isPlainObject(value)) return visitPrimitive(value);
  return visitObject(value, (child) =>
    walkSchema(child, visitObject, visitPrimitive),
  );
}

function identity(value: unknown): unknown {
  return value;
}

const OPENAI_SCHEMA_TYPES = [
  "string",
  "number",
  "boolean",
  "integer",
  "object",
  "array",
  "null",
];
const OPENAI_SCHEMA_COMPOSITION_KEYS = ["anyOf", "oneOf", "allOf"];

// Mirrors Codex's Rust JSON schema compatibility lowering for OpenAI tool schemas.
function sanitizeOpenAIObject(value: JsonRecord, walk: SchemaWalker): unknown {
  const result: JsonRecord = {};

  if (typeof value.$ref === "string") result.$ref = value.$ref;
  if (typeof value.description === "string")
    result.description = value.description;
  if ("const" in value) result.enum = [value.const];
  else if (Array.isArray(value.enum)) result.enum = value.enum;

  if (isPlainObject(value.properties)) {
    result.properties = Object.fromEntries(
      Object.entries(value.properties).map(([key, item]) => [key, walk(item)]),
    );
  }

  if (Array.isArray(value.required)) {
    result.required = value.required.filter((item) => typeof item === "string");
  }

  if ("items" in value) result.items = walk(value.items);

  if ("additionalProperties" in value) {
    result.additionalProperties =
      typeof value.additionalProperties === "boolean"
        ? value.additionalProperties
        : walk(value.additionalProperties);
  }

  for (const key of OPENAI_SCHEMA_COMPOSITION_KEYS) {
    if (Array.isArray(value[key])) result[key] = walk(value[key]);
  }

  for (const key of ["$defs", "definitions"]) {
    if (isPlainObject(value[key])) {
      result[key] = Object.fromEntries(
        Object.entries(value[key]).map(([name, item]) => [name, walk(item)]),
      );
    }
  }

  const schemaTypes =
    typeof value.type === "string"
      ? OPENAI_SCHEMA_TYPES.includes(value.type)
        ? [value.type]
        : []
      : Array.isArray(value.type)
        ? value.type.filter(
            (item) =>
              typeof item === "string" && OPENAI_SCHEMA_TYPES.includes(item),
          )
        : [];

  if (
    schemaTypes.length === 0 &&
    (typeof result.$ref === "string" ||
      OPENAI_SCHEMA_COMPOSITION_KEYS.some((key) => key in result))
  ) {
    return result;
  }

  // MCP schemas may omit `type` while still using keywords that imply one.
  // Keep the schema usable after unsupported keywords are dropped.
  const inferredTypes =
    schemaTypes.length > 0
      ? schemaTypes
      : ["properties", "required", "additionalProperties"].some(
            (key) => key in value,
          )
        ? ["object"]
        : ["items", "prefixItems"].some((key) => key in value)
          ? ["array"]
          : "enum" in result || "format" in value
            ? ["string"]
            : [
                  "minimum",
                  "maximum",
                  "exclusiveMinimum",
                  "exclusiveMaximum",
                  "multipleOf",
                ].some((key) => key in value)
              ? ["number"]
              : [];

  if (inferredTypes.length === 0) return {};

  result.type = inferredTypes.length === 1 ? inferredTypes[0] : inferredTypes;
  if (inferredTypes.includes("object") && !("properties" in result))
    result.properties = {};
  if (inferredTypes.includes("array") && !("items" in result))
    result.items = { type: "string" };
  return result;
}

function sanitizeOpenAISchema(value: unknown): unknown {
  // JSON Schema's boolean form (`true`/`false`) is unsupported by OpenAI tool schemas.
  return walkSchema(value, sanitizeOpenAIObject, (node) =>
    typeof node === "boolean" ? { type: "string" } : node,
  );
}

function sanitizeMoonshotObject(
  value: JsonRecord,
  walk: SchemaWalker,
): unknown {
  // Moonshot expands $ref before validation and rejects sibling keywords like description on the same node.
  if (typeof value.$ref === "string") return { $ref: value.$ref };
  const result = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, walk(item)]),
  );
  // MFJS does not support tuple-style `items` arrays; it requires one schema object for all array items.
  if (Array.isArray(result.items)) result.items = result.items[0] ?? {};
  return result;
}

function sanitizeMoonshotSchema(value: unknown): unknown {
  return walkSchema(value, sanitizeMoonshotObject);
}

function hasCombiner(node: unknown): boolean {
  return (
    isPlainObject(node) &&
    (Array.isArray(node.anyOf) ||
      Array.isArray(node.oneOf) ||
      Array.isArray(node.allOf))
  );
}

function hasSchemaIntent(node: unknown): boolean {
  if (!isPlainObject(node)) return false;
  if (hasCombiner(node)) return true;
  return [
    "type",
    "properties",
    "items",
    "prefixItems",
    "enum",
    "const",
    "$ref",
    "additionalProperties",
    "patternProperties",
    "required",
    "not",
    "if",
    "then",
    "else",
  ].some((key) => key in node);
}

function sanitizeGeminiObject(value: JsonRecord, walk: SchemaWalker): unknown {
  const result: JsonRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "enum" && Array.isArray(item)) {
      // Convert all enum values to strings
      result[key] = item.map((entry) => String(entry));
      // If we have integer type with enum, change type to string
      if (result.type === "integer" || result.type === "number") {
        result.type = "string";
      }
    } else if (typeof item === "object" && item !== null) {
      result[key] = walk(item);
    } else {
      result[key] = item;
    }
  }

  // Gemini requires a single `type`, not a JSON Schema type array such as
  // `["number","string"]` (emitted by some MCP servers). Plain `@ai-sdk/google`
  // rewrites these into an `anyOf` of single-type schemas, but OpenAI-compatible
  // transports (e.g. GitHub Copilot proxying to Gemini) forward them verbatim
  // and the backend rejects the array form. Mirror the SDK: split non-null
  // types into `anyOf`, and lift `null` into `nullable`.
  if (Array.isArray(result.type)) {
    const hasNull = result.type.includes("null");
    const nonNull = result.type.filter((entry: unknown) => entry !== "null");
    if (nonNull.length === 0) {
      result.type = "null";
    } else {
      delete result.type;
      result.anyOf = nonNull.map((entry: unknown) => ({ type: entry }));
      if (hasNull) result.nullable = true;
    }
  }

  // Filter required array to only include fields that exist in properties
  const properties = isPlainObject(result.properties)
    ? result.properties
    : undefined;
  if (
    result.type === "object" &&
    properties &&
    Array.isArray(result.required)
  ) {
    result.required = result.required.filter(
      (field): field is string =>
        typeof field === "string" && field in properties,
    );
  }

  if (result.type === "array" && !hasCombiner(result)) {
    if (result.items == null) {
      result.items = {};
    }
    // Ensure items has a type only when it's still schema-empty.
    if (isPlainObject(result.items) && !hasSchemaIntent(result.items)) {
      result.items.type = "string";
    }
  }

  // Remove properties/required from non-object types (Gemini rejects these)
  if (result.type && result.type !== "object" && !hasCombiner(result)) {
    delete result.properties;
    delete result.required;
  }

  return result;
}

function sanitizeGeminiSchema(value: unknown): unknown {
  return walkSchema(value, sanitizeGeminiObject);
}

export function schema(
  model: Provider.Model,
  schema: JSONSchema7,
): JSONSchema7 {
  if (model.api.npm === "@ai-sdk/openai" || model.api.npm === "@ai-sdk/azure") {
    schema = sanitizeOpenAISchema(schema) as JSONSchema7;
    // Codex also applies lossy compaction above 4 KB; defer that until Spinosa needs the same schema budget.
  }

  if (
    model.providerID === "moonshotai" ||
    model.api.id.toLowerCase().includes("kimi")
  ) {
    const sanitized = sanitizeMoonshotSchema(schema);
    if (isPlainObject(sanitized)) schema = sanitized as JSONSchema7;
  }

  // Convert integer enums to string enums for Google/Gemini
  if (model.providerID === "google" || model.api.id.includes("gemini")) {
    const sanitized = sanitizeGeminiSchema(schema);
    if (isPlainObject(sanitized)) schema = sanitized as JSONSchema7;
  }

  return schema;
}
