import type { JSONValue } from "@ai-sdk/provider";

export type ProviderJsonObject = Record<string, JSONValue | undefined>;

function toJsonValue(value: unknown): JSONValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const items = value.map(toJsonValue);
    return items.every((item): item is JSONValue => item !== undefined)
      ? items
      : undefined;
  }

  if (!isJsonObject(value)) return undefined;
  const result: ProviderJsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const converted = toJsonValue(item);
    if (converted !== undefined) result[key] = converted;
  }
  return result;
}

export function toJsonObject(
  value: Record<string, unknown>,
): ProviderJsonObject {
  const parsed = toJsonValue(value);
  if (!isJsonObject(parsed)) return {};
  const result: ProviderJsonObject = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (item !== undefined) result[key] = item;
  }
  return result;
}

function isJsonObject(value: unknown): value is ProviderJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
