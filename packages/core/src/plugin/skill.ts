/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./define"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeSpinosaContent from "./skill/customize-spinosa.md" with { type: "text" }

export const CustomizeSpinosaContent = customizeSpinosaContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-spinosa",
            description:
              "Use ONLY when the user is editing or creating spinosa's own configuration: spinosa.json, spinosa.jsonc, files under .spinosa/, or files under ~/.config/spinosa/. Also use when creating or fixing spinosa agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring spinosa itself.",
            location: AbsolutePath.make("/builtin/customize-spinosa.md"),
            content: CustomizeSpinosaContent,
          }),
        }),
      )
    })
  }),
})
