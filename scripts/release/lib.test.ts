import { describe, expect, test } from "bun:test"
import { PRODUCT_BINARY_TARGETS, productBinaryAssetName } from "../../packages/spinosa-core/src/distribution/contract.ts"
import { releasePaths } from "./lib.ts"

describe("releasePaths binary distribution", () => {
  test("exposes four product binaries and manifest — no archive assets", () => {
    const paths = releasePaths("1.0.3-beta.10")
    expect(paths.tag).toBe("v1.0.3-beta.10")
    expect(paths.channel).toBe("beta")
    expect(paths.binaryNames).toEqual(PRODUCT_BINARY_TARGETS.map(productBinaryAssetName))
    expect(Object.keys(paths.binaryPaths).sort()).toEqual([...PRODUCT_BINARY_TARGETS].sort())
    for (const target of PRODUCT_BINARY_TARGETS) {
      expect(paths.binaryPaths[target]).toEndWith(productBinaryAssetName(target))
    }
    expect(paths.manifestPath).toEndWith("build-manifest.json")
    expect(paths.installPath).toEndWith("install.sh")
    expect(paths.checksumsPath).toEndWith("checksums.txt")
    expect(paths.channelInstallPath).toInclude("/dist/beta/install.sh")
    expect(paths.channelChecksumsPath).toInclude("/dist/beta/checksums.txt")
    expect(paths).not.toHaveProperty("archiveName")
    expect(paths).not.toHaveProperty("archivePath")
  })

  test("stable channel maps channel dist under dist/stable", () => {
    const paths = releasePaths("1.0.3")
    expect(paths.channel).toBe("stable")
    expect(paths.channelInstallPath).toInclude("/dist/stable/install.sh")
  })
})
