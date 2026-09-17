import { describe, expect, test } from "bun:test";
import { isVisionProviderSelectable } from "../../../../src/component/dialog-vision";

describe("isVisionProviderSelectable", () => {
  test("hides OpenAI when the connected credential is OAuth-only", () => {
    expect(isVisionProviderSelectable({ id: "openai", source: "custom" })).toBe(
      false,
    );
  });

  test("keeps OpenAI API-key connections and other OAuth providers", () => {
    expect(isVisionProviderSelectable({ id: "openai", source: "api" })).toBe(
      true,
    );
    expect(isVisionProviderSelectable({ id: "openai", source: "env" })).toBe(
      true,
    );
    expect(
      isVisionProviderSelectable({ id: "anthropic", source: "custom" }),
    ).toBe(true);
  });
});
