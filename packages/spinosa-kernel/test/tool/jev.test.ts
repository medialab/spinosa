import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
    AUTH_ID,
    apiKeyFromAuth,
    MAX_PASSAGES,
    MAX_SNIPPET,
    buildJevRequest,
    decisionForScore,
    formatScreenOutput,
    normalizePassages,
    rankAnswers,
    resolveJevApiKey,
} from "../../src/tool/jev"
import { TypesafeAuthPlugin } from "../../src/plugin/typesafe"

describe("jev screen", () => {
  test("normalizes ids, drops empty text, and caps length", () => {
    const passages = normalizePassages([
      { path: "raw/a.md", text: "  usable quote  " },
      { path: "raw/b.md", text: "   " },
      { text: "x".repeat(MAX_SNIPPET + 40) },
    ])
    expect(passages).toHaveLength(2)
    expect(passages[0]).toEqual({ id: "p0", path: "raw/a.md", text: "usable quote" })
    expect(passages[1]?.id).toBe("p1")
    expect(passages[1]?.path).toBe("(no path)")
    expect(passages[1]?.text).toHaveLength(MAX_SNIPPET)
  })

  test("keeps at most MAX_PASSAGES", () => {
    const raw = Array.from({ length: MAX_PASSAGES + 5 }, (_, index) => ({
      path: `raw/${index}.md`,
      text: `hit ${index}`,
    }))
    expect(normalizePassages(raw)).toHaveLength(MAX_PASSAGES)
  })

  test("builds one score question per passage", () => {
    const request = buildJevRequest("what is X?", [
      { id: "p0", path: "raw/a.md", text: "X is 1" },
      { id: "p1", path: "raw/b.md", text: "unrelated" },
    ])
    expect(request.model).toBe("jev-1.13.0")
    expect(request.state.query).toBe("what is X?")
    expect(Object.keys(request.questions)).toEqual(["p0", "p1"])
    expect(request.questions.p0?.type).toBe("score")
    expect(request.questions.p0?.criteria).toHaveLength(3)
    expect(request.questions.p0?.instructions).toContain("what is X?")
    expect(request.questions.p0?.instructions).toContain("X is 1")
    expect(request.questions.p1?.instructions).toContain("unrelated")
  })

  test("ranks read ahead of skip", () => {
    const ranked = rankAnswers(
      [
        { id: "p0", path: "raw/noise.md", text: "hello" },
        { id: "p1", path: "raw/hit.md", text: "the answer is 42" },
      ],
      {
        p0: { type: "score", score: 0.1, confidence: 0.9 },
        p1: { type: "score", score: 2.0, confidence: 0.8 },
      },
    )
    expect(ranked.map((item) => item.path)).toEqual(["raw/hit.md", "raw/noise.md"])
    expect(ranked[0]?.decision).toBe("read")
    expect(ranked[1]?.decision).toBe("skip")
  })

  test("score bands", () => {
    expect(decisionForScore(1.5)).toBe("read")
    expect(decisionForScore(0.75)).toBe("maybe")
    expect(decisionForScore(0.2)).toBe("skip")
  })

  test("output lists the read band first", () => {
    const text = formatScreenOutput("causes of reversal", [
      {
        id: "p1",
        path: "raw/earth.md",
        text: "geomagnetic reversal",
        score: 1.9,
        confidence: 0.9,
        decision: "read",
      },
      {
        id: "p0",
        path: "raw/other.md",
        text: "weather",
        score: 0.1,
        confidence: 0.4,
        decision: "skip",
      },
    ])
    expect(text).toContain("counts: read=1 maybe=0 skip=1")
    expect(text.indexOf("READ")).toBeLessThan(text.indexOf("SKIP"))
    expect(text).toContain("raw/earth.md")
  })
})

async function withClearedJevEnv(run: () => Promise<void>) {
  const typesafe = process.env.TYPESAFE_API_KEY
  const jev = process.env.JEV_API_KEY
  delete process.env.TYPESAFE_API_KEY
  delete process.env.JEV_API_KEY
  try {
    await run()
  } finally {
    if (typesafe === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = typesafe
    if (jev === undefined) delete process.env.JEV_API_KEY
    else process.env.JEV_API_KEY = jev
  }
}

describe("jev credentials", () => {
  test("reads the typesafe api key from the auth store", async () => {
    await withClearedJevEnv(async () => {
      const key = await Effect.runPromise(
        resolveJevApiKey((id) =>
          Effect.succeed(id === AUTH_ID ? { type: "api", key: "stored-key" } : undefined),
        ),
      )
      expect(key).toBe("stored-key")
    })
  })

  test("accepts the jev alias in the auth store", async () => {
    await withClearedJevEnv(async () => {
      const key = await Effect.runPromise(
        resolveJevApiKey((id) => Effect.succeed(id === "jev" ? { type: "api", key: "alias-key" } : undefined)),
      )
      expect(key).toBe("alias-key")
    })
  })

  test("prefers the environment over the auth store", async () => {
    await withClearedJevEnv(async () => {
      process.env.TYPESAFE_API_KEY = "env-key"
      const key = await Effect.runPromise(
        resolveJevApiKey(() => Effect.succeed({ type: "api", key: "stored-key" })),
      )
      expect(key).toBe("env-key")
    })
  })

  test("ignores non-api auth entries", () => {
    expect(
      apiKeyFromAuth({
        type: "oauth",
        refresh: "r",
        access: "a",
        expires: 1,
      }),
    ).toBeUndefined()
    expect(apiKeyFromAuth({ type: "api", key: "  " })).toBeUndefined()
  })
})

describe("typesafe auth plugin", () => {
  test("registers an api login for typesafe", async () => {
    const hooks = await TypesafeAuthPlugin({} as never)
    expect(hooks.auth?.provider).toBe(AUTH_ID)
    expect(hooks.auth?.methods[0]?.type).toBe("api")
  })
})
