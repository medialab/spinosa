import { describe, expect, test } from "bun:test"
import {
  cleanTag,
  isBetaVersion,
  previousBetaVersion,
  validateTagRelease,
} from "./validate-tag.ts"

describe("tag-triggered release gate", () => {
  test("cleanTag accepts v<semver>, rejects the rest", () => {
    expect(cleanTag("v1.1.0-beta.17.18")).toBe("1.1.0-beta.17.18")
    expect(cleanTag("1.1.0-beta.17.18")).toBe("1.1.0-beta.17.18")
    expect(cleanTag("beta")).toBeUndefined()
    expect(cleanTag("vnot-a-version")).toBeUndefined()
  })

  test("isBetaVersion matches the beta line only", () => {
    expect(isBetaVersion("1.1.0-beta.17.18")).toBe(true)
    expect(isBetaVersion("1.1.0")).toBe(false)
    expect(isBetaVersion("1.1.0-rc.1")).toBe(false)
  })

  test("previousBetaVersion picks the greatest beta tag", () => {
    expect(previousBetaVersion([
      "v1.1.0-beta.14",
      "v1.1.0-beta.17.17",
      "v1.1.0-beta.9",
      "v1.0.3",
      "beta",
    ])).toBe("1.1.0-beta.17.17")
    expect(previousBetaVersion(["v1.1.0"])).toBeUndefined()
    expect(previousBetaVersion([])).toBeUndefined()
  })

  test("valid tag passes all checks", () => {
    expect(validateTagRelease({
      tag: "v1.1.0-beta.17.18",
      previousTags: ["v1.1.0-beta.17.17", "v1.1.0-beta.14"],
      packageVersion: "1.1.0-beta.17.18",
      changelog: "## [1.1.0-beta.17.18] — 2026-09-14\n\n### Fixed\n\n- Thing.\n",
    })).toEqual([])
  })

  test("non-greater tag is rejected", () => {
    const errors = validateTagRelease({
      tag: "v1.1.0-beta.17.16",
      previousTags: ["v1.1.0-beta.17.17", "v1.1.0-beta.14"],
      packageVersion: "1.1.0-beta.17.16",
      changelog: "## [1.1.0-beta.17.16]\n",
    })
    expect(errors.join("\n")).toContain("not greater than previous beta v1.1.0-beta.17.17")
  })

  test("re-pushing the current tag is allowed (CI retry stays unblocked)", () => {
    expect(validateTagRelease({
      tag: "v1.1.0-beta.17.17",
      previousTags: ["v1.1.0-beta.17.17", "v1.1.0-beta.14"],
      packageVersion: "1.1.0-beta.17.17",
      changelog: "## [1.1.0-beta.17.17]\n",
    })).toEqual([])
  })

  test("version and changelog mismatches are rejected", () => {
    const errors = validateTagRelease({
      tag: "v1.1.0-beta.17.18",
      previousTags: ["v1.1.0-beta.17.17"],
      packageVersion: "1.1.0-beta.17.17",
      changelog: "## [Unreleased]\n",
    })
    expect(errors.join("\n")).toContain("package.json says 1.1.0-beta.17.17")
    expect(errors.join("\n")).toContain("CHANGELOG.md missing section")
  })

  test("non-beta and malformed tags are rejected", () => {
    expect(validateTagRelease({
      tag: "v1.1.0",
      previousTags: [],
      packageVersion: "1.1.0",
      changelog: "## [1.1.0]\n",
    }).join("\n")).toContain("not on the beta line")
    expect(validateTagRelease({
      tag: "not-a-tag",
      previousTags: [],
      packageVersion: "1.1.0-beta.17.18",
      changelog: "",
    })).toHaveLength(1)
  })
})
