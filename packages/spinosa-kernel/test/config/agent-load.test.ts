import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigAgent } from "@/config/agent"

test("loads Spinosa agents from the .opencode mirror unless .spinosa overrides them", async () => {
  const root = await mkdtemp(join(tmpdir(), "spinosa-agent-config-"))
  const nativeAgents = join(root, ".spinosa", "agents")
  const mirroredAgents = join(root, ".opencode", "agents")
  await mkdir(nativeAgents, { recursive: true })
  await mkdir(mirroredAgents, { recursive: true })

  try {
    await writeFile(
      join(mirroredAgents, "spinosa-searcher.md"),
      "---\nmode: subagent\ndescription: Search the Spinosa workspace\npermission:\n  read: allow\n---\nMirror prompt.\n",
    )
    await writeFile(
      join(nativeAgents, "spinosa-searcher.md"),
      "---\nmode: subagent\ndescription: Native override\npermission:\n  grep: allow\n---\nNative prompt.\n",
    )

    const agents = await ConfigAgent.load(join(root, ".spinosa"))

    expect(agents["spinosa-searcher"]).toMatchObject({
      mode: "subagent",
      description: "Native override",
      prompt: "Native prompt.",
    })
    expect(agents["spinosa-searcher"]?.permission).toMatchObject({ grep: "allow" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
