import { expect, test } from "bun:test"
import { groupPromptInputV2Suggestions } from "./interaction"
import type { PromptInputV2Suggestion } from "./types"

const item = (id: string, section: "commands" | "skills"): PromptInputV2Suggestion => ({
  id,
  kind: "command",
  label: `/${id}`,
  section: { id: section, label: section, tag: section },
})

test("groups filtered commands before skills while preserving order within each section", () => {
  const grouped = groupPromptInputV2Suggestions([item("skill-b", "skills"), item("command-b", "commands"), item("command-a", "commands"), item("skill-a", "skills")])

  expect(grouped.map((group) => [group.id, group.items.map((suggestion) => suggestion.id)])).toEqual([
    ["commands", ["command-b", "command-a"]],
    ["skills", ["skill-b", "skill-a"]],
  ])
})
