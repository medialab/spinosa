import { describe, expect, test } from "bun:test";
import { SessionV1 } from "@spinosa/kernel-core/v1/session";
import { MessageID, PartID, SessionID } from "../../src/session/schema";
import { snapshotRange, unquoteGitPath } from "../../src/session/summary-helpers";

const sessionID = SessionID.descending();

const stepStart = (snapshot?: string): SessionV1.StepStartPart => ({
  id: PartID.ascending(),
  sessionID,
  messageID: MessageID.ascending(),
  type: "step-start",
  snapshot,
});

const stepFinish = (snapshot?: string): SessionV1.StepFinishPart => ({
  id: PartID.ascending(),
  sessionID,
  messageID: MessageID.ascending(),
  type: "step-finish",
  reason: "stop",
  snapshot,
  cost: 0,
  tokens: {
    total: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
});

const withParts = (parts: SessionV1.Part[]) => ({ parts });

describe("session summary helpers", () => {
  test("finds the first start and last finish snapshot", () => {
    expect(
      snapshotRange([
        withParts([stepStart("before"), stepFinish("middle")]),
        withParts([stepStart("ignored"), stepFinish("after")]),
      ]),
    ).toEqual({ from: "before", to: "after" });
  });

  test("returns no range when either snapshot is missing", () => {
    expect(snapshotRange([withParts([stepFinish("after")])])).toBeUndefined();
    expect(snapshotRange([withParts([stepStart("before")])])).toBeUndefined();
    expect(snapshotRange([])).toBeUndefined();
  });

  test("decodes git quoted paths and leaves plain paths alone", () => {
    expect(unquoteGitPath('"src\\040file\\011name.ts"')).toBe(
      "src file\tname.ts",
    );
    expect(unquoteGitPath("src/file.ts")).toBe("src/file.ts");
    expect(unquoteGitPath('"unterminated')).toBe('"unterminated');
  });
});
