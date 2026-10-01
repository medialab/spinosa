import { describe, expect, test } from "bun:test"
import { stripNonCodeSegments } from "./quality-report.ts"

const count = (text: string, token: "any" | "unknown"): number =>
  stripNonCodeSegments(text).match(new RegExp(`\\b${token}\\b`, "g"))?.length ?? 0

describe("stripNonCodeSegments", () => {
  test("keeps real type annotations", () => {
    expect(count("const x: any = 1;", "any")).toBe(1)
    expect(count("function f(v: unknown): void {}", "unknown")).toBe(1)
    expect(count("const xs: Array<any> = [];", "any")).toBe(1)
  })

  test("drops line and block comments", () => {
    expect(count("// after any change\nconst x = 1;", "any")).toBe(0)
    expect(count("/* any unknown */\nconst x = 1;", "any")).toBe(0)
    expect(count("/* any unknown */\nconst x = 1;", "unknown")).toBe(0)
  })

  test("drops quoted prose", () => {
    expect(count(`const s = "for any input";`, "any")).toBe(0)
    expect(count(`const s = 'in any order';`, "any")).toBe(0)
    expect(count(`const u = "it is unknown";`, "unknown")).toBe(0)
  })

  test("drops template literal text but keeps interpolation code", () => {
    expect(count("const s = `for any input`;", "any")).toBe(0)
    expect(count("const s = `${x as any} items`;", "any")).toBe(1)
  })

  test("handles urls and escapes without swallowing code", () => {
    expect(count(`const u = "https://example.com";\nconst x: any = 1;`, "any")).toBe(1)
    expect(count(`const s = "don\\'t";\nconst x: any = 1;`, "any")).toBe(1)
  })

  test("never hangs on backticks", () => {
    expect(count("const s = `unclosed;", "any")).toBe(0)
    expect(count("```", "any")).toBe(0)
  })
})
