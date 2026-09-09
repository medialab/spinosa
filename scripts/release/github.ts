import { readFileSync } from "node:fs"
import path from "node:path"
import { Octokit } from "@octokit/rest"
import type { ReleaseChannel } from "../../packages/spinosa-core/src/utils/version.ts"

export interface ReleaseRepo {
  owner: string
  repo: string
}

export function parseReleaseRepo(value = process.env.SPINOSA_RELEASE_REPO ?? "medialab/spinosa"): ReleaseRepo {
  const [owner, repo] = value.split("/")
  if (!owner || !repo) {
    throw new Error(`Invalid release repo: ${value}`)
  }
  return { owner, repo }
}

export function createReleaseOctokit(): Octokit {
  const auth = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (!auth) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN is required for GitHub release operations")
  }
  return new Octokit({ auth })
}

async function findReleaseAssetId(
  octokit: Octokit,
  repo: ReleaseRepo,
  releaseId: number,
  assetName: string,
): Promise<number | undefined> {
  const assets = await octokit.paginate(octokit.rest.repos.listReleaseAssets, {
    owner: repo.owner,
    repo: repo.repo,
    release_id: releaseId,
    per_page: 100,
  })
  return assets.find((asset) => asset.name === assetName)?.id
}

async function uploadReleaseFile(
  octokit: Octokit,
  repo: ReleaseRepo,
  releaseId: number,
  filePath: string,
  assetName: string,
): Promise<void> {
  const existingId = await findReleaseAssetId(octokit, repo, releaseId, assetName)
  if (existingId) {
    await octokit.rest.repos.deleteReleaseAsset({
      owner: repo.owner,
      repo: repo.repo,
      asset_id: existingId,
    })
  }

  const data = readFileSync(filePath)
  await octokit.rest.repos.uploadReleaseAsset({
    owner: repo.owner,
    repo: repo.repo,
    release_id: releaseId,
    name: assetName,
    data,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": data.length,
    },
  })
}

export async function getRollingChannelRelease(
  octokit: Octokit,
  repo: ReleaseRepo,
  channel: ReleaseChannel,
) {
  return octokit.rest.repos.getReleaseByTag({
    owner: repo.owner,
    repo: repo.repo,
    tag: channel,
  })
}

export async function publishRollingChannelRelease(input: {
  version: string
  channel: ReleaseChannel
  channelDist: string
}): Promise<void> {
  const octokit = createReleaseOctokit()
  const repo = parseReleaseRepo()
  const title = `Spinosa v${input.version} (${input.channel})`
  const notes = `Rolling ${input.channel} channel — points to v${input.version}`
  const prerelease = input.channel === "beta"

  let releaseId: number
  try {
    const release = await getRollingChannelRelease(octokit, repo, input.channel)
    releaseId = release.data.id
    await octokit.rest.repos.updateRelease({
      owner: repo.owner,
      repo: repo.repo,
      release_id: releaseId,
      tag_name: input.channel,
      name: title,
      body: notes,
      prerelease,
    })
  } catch (error) {
    if (!(error && typeof error === "object" && "status" in error && error.status === 404)) {
      throw error
    }
    const created = await octokit.rest.repos.createRelease({
      owner: repo.owner,
      repo: repo.repo,
      tag_name: input.channel,
      name: title,
      body: notes,
      prerelease,
    })
    releaseId = created.data.id
  }

  const installPath = path.join(input.channelDist, "install.sh")
  const checksumsPath = path.join(input.channelDist, "checksums.txt")
  // Rolling channel publishes installer + checksums only (no binaries / no archive).
  await uploadReleaseFile(octokit, repo, releaseId, installPath, "install.sh")
  await uploadReleaseFile(octokit, repo, releaseId, checksumsPath, "checksums.txt")
}

export function readPinnedVersionFromInstallerScript(script: string): string | undefined {
  const match = script.match(/^PINNED_VERSION="([^"]+)"/m)
  return match?.[1]
}

export async function assertRollingChannelInstaller(input: {
  version: string
  channel: ReleaseChannel
}): Promise<string> {
  const octokit = createReleaseOctokit()
  const repo = parseReleaseRepo()
  const release = await getRollingChannelRelease(octokit, repo, input.channel)
  const expectedTitle = `Spinosa v${input.version} (${input.channel})`
  if (release.data.name !== expectedTitle) {
    throw new Error(`rolling ${input.channel} release title is "${release.data.name}", expected "${expectedTitle}"`)
  }

  const installAsset = release.data.assets?.find((asset) => asset.name === "install.sh")
  if (!installAsset?.browser_download_url) {
    throw new Error(`rolling ${input.channel} release is missing install.sh asset`)
  }

  const response = await fetch(installAsset.browser_download_url)
  if (!response.ok) {
    throw new Error(`failed to download rolling ${input.channel} installer (${response.status})`)
  }

  const script = await response.text()
  const pinned = readPinnedVersionFromInstallerScript(script)
  if (!pinned) {
    throw new Error(`could not read PINNED_VERSION from rolling ${input.channel} installer`)
  }
  if (pinned !== input.version) {
    throw new Error(`rolling ${input.channel} installer serves PINNED_VERSION=${pinned}, expected ${input.version}`)
  }

  return pinned
}

export async function downloadRollingChannelInstaller(channel: ReleaseChannel): Promise<string> {
  const octokit = createReleaseOctokit()
  const repo = parseReleaseRepo()
  const release = await getRollingChannelRelease(octokit, repo, channel)
  const installAsset = release.data.assets?.find((asset) => asset.name === "install.sh")
  if (!installAsset?.browser_download_url) {
    throw new Error(`rolling ${channel} release is missing install.sh asset`)
  }
  const response = await fetch(installAsset.browser_download_url)
  if (!response.ok) {
    throw new Error(`failed to download rolling ${channel} installer (${response.status})`)
  }
  return response.text()
}
