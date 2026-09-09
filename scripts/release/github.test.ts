import { describe, expect, test } from "bun:test"
import { parseReleaseRepo, readPinnedVersionFromInstallerScript } from "./github.ts"

describe("release github helpers", () => {
  test("parses owner and repo from SPINOSA_RELEASE_REPO", () => {
    expect(parseReleaseRepo("medialab/spinosa")).toEqual({
      owner: "medialab",
      repo: "spinosa",
    })
  })

  test("reads pinned installer versions", () => {
    const script = '#!/bin/sh\nPINNED_VERSION="1.0.2-beta.14"\nPINNED_TAG="beta"\n'
    expect(readPinnedVersionFromInstallerScript(script)).toBe("1.0.2-beta.14")
  })
})
