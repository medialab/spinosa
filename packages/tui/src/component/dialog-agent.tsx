import { createMemo, createResource } from "solid-js"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSpinosaWorkspace } from "../context/spinosa-workspace"
import { agentDisplayName } from "../util/agent"
import { DialogMdViewer } from "../routes/session/dialog-md-viewer"
import { safeResourceValue } from "../util/resource"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()
  const spinosa = useSpinosaWorkspace()

  const [spinosaAgents] = createResource(async (): Promise<{ name: string; path: string }[]> => {
    const ws = spinosa.activePath
    if (!ws || spinosa.genericMode) return []
    const agentsDir = path.join(ws, ".agents", "agents")
    try {
      const files = await readdir(agentsDir)
      return files
        .filter((f) => f.endsWith(".md"))
        .map((f) => ({
          name: f.replace(/\.md$/, "").replace(/^spinosa-/, ""),
          path: path.join(agentsDir, f),
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  })

  const options = createMemo(() => {
    const sdkAgents = local.agent.list().map((item) => ({
      value: "sdk:" + item.name,
      title: agentDisplayName(item.name),
      description: item.native ? "native" : item.description,
      category: "SDK Agents",
    }))

    const wsAgents = (safeResourceValue(spinosaAgents) ?? []).map((a) => ({
      value: "file:" + a.path,
      title: a.name.charAt(0).toUpperCase() + a.name.slice(1),
      description: "View agent definition",
      category: "Spinosa Agents",
    }))

    return [...sdkAgents, ...wsAgents]
  })

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current()?.name}
      options={options()}
      loading={spinosaAgents.loading}
      loadingText="Loading agents…"
      onSelect={(option) => {
        if (option.value.startsWith("sdk:")) {
          local.agent.set(option.value.slice(4))
          dialog.clear()
        } else if (option.value.startsWith("file:")) {
          const filePath = option.value.slice(5)
          dialog.replace(() => <DialogMdViewer filePath={filePath} />)
        }
      }}
    />
  )
}
