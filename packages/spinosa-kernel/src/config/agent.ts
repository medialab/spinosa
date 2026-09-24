export * as ConfigAgent from "./agent"

import { existsSync } from "node:fs"
import path from "path"
import { Exit, Schema } from "effect"
import { Glob } from "@spinosa/kernel-core/util/glob"
import { ConfigAgentV1 } from "@spinosa/kernel-core/v1/config/agent"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"
import { ConfigParse } from "./parse"

export async function load(dir: string) {
  const result: Record<string, ConfigAgentV1.Info> = {}
  const roots =
    path.basename(dir) === ".spinosa" && existsSync(path.join(path.dirname(dir), ".opencode"))
      ? [path.join(path.dirname(dir), ".opencode"), dir]
      : [dir]
  for (const root of roots) {
    for (const item of await Glob.scan("{agent,agents}/**/*.md", {
      cwd: root,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(() => undefined)
      if (!md) continue

      const name = configEntryNameFromPath(path.relative(root, item), ["agent/", "agents/"])
      const config = {
        name,
        ...md.data,
        prompt: md.content.trim(),
      }
      result[config.name] = ConfigParse.schema(ConfigAgentV1.Info, config, item)
    }
  }
  return result
}

export async function loadMode(dir: string) {
  const result: Record<string, ConfigAgentV1.Info> = {}
  for (const item of await Glob.scan("{mode,modes}/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(() => undefined)
    if (!md) continue

    const config = {
      name: configEntryNameFromPath(path.relative(dir, item), ["mode/", "modes/"]),
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Schema.decodeUnknownExit(ConfigAgentV1.Info)(config, { errors: "all", propertyOrder: "original" })
    if (Exit.isSuccess(parsed)) {
      result[config.name] = {
        ...parsed.value,
        mode: "primary" as const,
      }
    }
  }
  return result
}
