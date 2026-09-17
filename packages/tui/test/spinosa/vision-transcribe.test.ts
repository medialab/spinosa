import { describe, expect, test } from "bun:test";
import { visionTranscribeResultText } from "../../src/spinosa/vision-transcribe";

describe("visionTranscribeResultText", () => {
  test("returns trimmed transcription text", () => {
    expect(
      visionTranscribeResultText({ data: { text: "  page text  " } }),
    ).toBe("page text");
  });

  test("surfaces the kernel error message instead of serialized JSON", () => {
    expect(() =>
      visionTranscribeResultText({
        error: {
          name: "BadRequest",
          data: { message: "Missing scopes: api.responses.write" },
        },
      }),
    ).toThrow("Missing scopes: api.responses.write");
  });

  test("rejects empty successful responses", () => {
    expect(() => visionTranscribeResultText({ data: { text: " " } })).toThrow(
      "Vision model returned no text",
    );
  });
});
