import { describe, expect, test } from "bun:test"
import { InstallationVersion, OpenCodeCompatVersion } from "@spinosa/kernel-core/installation/version"
import { OPENCODE_USER_AGENT, SPINOSA_USER_AGENT } from "@/session/llm/request"
import semver from "semver"

describe("LLM request User-Agent", () => {
  test("Console User-Agent uses OpenCode fork version, not product version", async () => {
    const kernelPkg = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as {
      version: string
    }
    const corePkg = (await Bun.file(new URL("../../../core/package.json", import.meta.url)).json()) as {
      version: string
    }

    expect(OpenCodeCompatVersion).toBe(corePkg.version)
    expect(OpenCodeCompatVersion).toBe(kernelPkg.version)
    expect(semver.gte(OpenCodeCompatVersion, "1.17.0")).toBe(true)
    expect(OPENCODE_USER_AGENT).toBe(`opencode/${OpenCodeCompatVersion}`)
    expect(OPENCODE_USER_AGENT).not.toBe(`opencode/${InstallationVersion}`)
    expect(SPINOSA_USER_AGENT).toBe(`spinosa/${InstallationVersion}`)
    expect(semver.gte(InstallationVersion, "1.17.0")).toBe(false)
  })

  test("request prep binds Console User-Agent to OpenCodeCompatVersion", async () => {
    const source = await Bun.file(new URL("../../src/session/llm/request.ts", import.meta.url)).text()
    expect(source).toContain("opencode/${OpenCodeCompatVersion}")
    expect(source).not.toContain("opencode/${InstallationVersion}")
  })
})
