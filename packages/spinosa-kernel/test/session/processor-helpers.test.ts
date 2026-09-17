import { describe, expect, test } from "bun:test";
import { SessionV1 } from "@spinosa/kernel-core/v1/session";
import { LLMEvent } from "@spinosa/llm";
import { isDoomLoop, toolResultOutput } from "../../src/session/processor-helpers";
import { MessageID, PartID, SessionID } from "../../src/session/schema";

const sessionID = SessionID.descending();

const toolPart = (
  input: Record<string, string>,
  status: "completed" | "pending" = "completed",
): SessionV1.ToolPart => ({
  id: PartID.ascending(),
  sessionID,
  messageID: MessageID.ascending(),
  type: "tool",
  tool: "lookup",
  callID: `call_${PartID.ascending()}`,
  state:
    status === "pending"
      ? { status, input, raw: "" }
      : {
          status,
          input,
          output: "ok",
          title: "lookup",
          metadata: {},
          time: { start: 0, end: 1 },
        },
});

describe("session processor helpers", () => {
  test("requires three matching completed calls for a doom loop", () => {
    const parts = [
      toolPart({ path: "/tmp" }),
      toolPart({ path: "/tmp" }),
      toolPart({ path: "/tmp" }),
    ];

    expect(isDoomLoop(parts, "lookup", { path: "/tmp" })).toBe(true);
    expect(isDoomLoop(parts.slice(1), "lookup", { path: "/tmp" })).toBe(false);
    expect(
      isDoomLoop(
        [...parts.slice(0, 2), toolPart({ path: "/other" })],
        "lookup",
        { path: "/tmp" },
      ),
    ).toBe(false);
    expect(
      isDoomLoop(
        [...parts.slice(0, 2), toolPart({ path: "/tmp" }, "pending")],
        "lookup",
        { path: "/tmp" },
      ),
    ).toBe(false);
  });

  test("normalizes structured and primitive tool output", () => {
    const structured = toolResultOutput(
      LLMEvent.toolResult({
        id: "call-1",
        name: "lookup",
        result: {
          type: "json",
          value: {
            output: "found",
            title: "Search",
            metadata: { source: "cache" },
          },
        },
      }),
    );
    expect(structured).toMatchObject({
      title: "Search",
      output: "found",
      metadata: { source: "cache" },
    });

    expect(
      toolResultOutput(
        LLMEvent.toolResult({
          id: "call-2",
          name: "lookup",
          result: { type: "text", value: "plain" },
        }),
      ),
    ).toMatchObject({ title: "lookup", output: "plain", metadata: {} });
  });
});
