import { describe, expect, test } from "bun:test"
import { slugify } from "../../src/util/slugify"

describe("slugify", () => {
  test("folds to lowercase hyphenated tokens", () => {
    expect(slugify(" Hello World ")).toBe("hello-world")
    expect(slugify("Foo---Bar!")).toBe("foo-bar")
  })
})
