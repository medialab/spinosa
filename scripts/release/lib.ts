import { resolve } from "node:path"
import {
  PRODUCT_BINARY_TARGETS,
  productBinaryAssetName,
  type ProductBinaryTarget,
} from "../../packages/spinosa-core/src/distribution/contract.ts"
import { releaseChannel } from "../../packages/spinosa-core/src/utils/version.ts"

export const RELEASE_ROOT = resolve(import.meta.dir, "../..")

export type ReleasePaths = {
  version: string
  tag: string
  channel: ReturnType<typeof releaseChannel>
  dist: string
  channelDist: string
  /** Canonical asset filenames for the four product binaries. */
  binaryNames: readonly string[]
  /** Absolute paths for each product binary under dist/v{version}/. */
  binaryPaths: Record<ProductBinaryTarget, string>
  installPath: string
  checksumsPath: string
  manifestPath: string
  channelInstallPath: string
  channelChecksumsPath: string
}

export function releasePaths(version: string): ReleasePaths {
  const tag = `v${version}`
  const channel = releaseChannel(version)
  const dist = resolve(RELEASE_ROOT, `dist/v${version}`)
  const channelDist = resolve(RELEASE_ROOT, `dist/${channel}`)
  const binaryNames = PRODUCT_BINARY_TARGETS.map(productBinaryAssetName)
  const binaryPaths = Object.fromEntries(
    PRODUCT_BINARY_TARGETS.map((target) => [target, resolve(dist, productBinaryAssetName(target))]),
  ) as Record<ProductBinaryTarget, string>
  return {
    version,
    tag,
    channel,
    dist,
    channelDist,
    binaryNames,
    binaryPaths,
    installPath: resolve(dist, "install.sh"),
    checksumsPath: resolve(dist, "checksums.txt"),
    manifestPath: resolve(dist, "build-manifest.json"),
    channelInstallPath: resolve(channelDist, "install.sh"),
    channelChecksumsPath: resolve(channelDist, "checksums.txt"),
  }
}
