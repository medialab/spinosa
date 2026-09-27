import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@spinosa/kernel-core/v1/session"
import { latestUserRequest } from "../../src/tool/spinosa-route"

function message(role: "user" | "assistant", parts: SessionV1.Part[]): SessionV1.WithParts {
  return {
    info: { role } as SessionV1.Info,
    parts,
  }
}

describe("latestUserRequest", () => {
  test("returns only user-authored text from the latest user turn", () => {
    const messages = [
      message("user", [{ type: "text", text: "older request" } as SessionV1.TextPart]),
      message("assistant", [{ type: "text", text: "assistant summary" } as SessionV1.TextPart]),
      message("user", [
        { type: "text", text: "# Index This Workspace", synthetic: false } as SessionV1.TextPart,
        { type: "text", text: "hidden attachment summary", synthetic: true } as SessionV1.TextPart,
      ]),
    ]

    expect(latestUserRequest(messages)).toBe("# Index This Workspace")
  })

  test("returns undefined when there is no user-authored text", () => {
    expect(latestUserRequest([message("assistant", [{ type: "text", text: "summary" } as SessionV1.TextPart])])).toBeUndefined()
    expect(latestUserRequest([])).toBeUndefined()
  })
})
