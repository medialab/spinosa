import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { FIXTURES_REAL_DIR } from "./fixtures-real"

const REPO_ROOT = path.join(__dirname, "..", "..", "..")

describe("fixtures-real guard", () => {
  test("corpus dir is git-ignored (can never be committed)", () => {
    // git check-ignore exits 0 when the path IS ignored; throws otherwise.
    expect(() =>
      execFileSync("git", ["check-ignore", "-q", path.relative(REPO_ROOT, FIXTURES_REAL_DIR)], {
        cwd: REPO_ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow()
  })

  test("staging dir is git-ignored", () => {
    expect(() =>
      execFileSync(
        "git",
        ["check-ignore", "-q", "packages/spinosa-core/test/fixtures-real-staging"],
        { cwd: REPO_ROOT, stdio: "pipe" },
      ),
    ).not.toThrow()
  })
})
