import { type ContextItem, type Prompt, type usePrompt } from "@/context/prompt"

type PromptTarget = ReturnType<ReturnType<typeof usePrompt>["capture"]>

export function mergeSubmissionContext(
  items: (ContextItem & { key: string })[],
  selected: ContextItem | undefined,
): (ContextItem & { key: string })[] {
  if (!selected) return items
  const start = selected.type === "file" ? selected.selection?.startLine : undefined
  const end = selected.type === "file" ? selected.selection?.endLine : undefined
  const key = `${selected.type}:${selected.type === "file" ? selected.path : ""}:${start}:${end}`
  if (items.some((item) => item.key === key)) return items
  return [...items, { ...selected, key }]
}

export function createPromptSubmissionState(input: {
  target: PromptTarget
  prompt: Prompt
  context: (ContextItem & { key: string })[]
}) {
  const initial = input.target
  let target = input.target
  let cleared: Prompt | undefined

  return {
    prompt: input.prompt,
    context: input.context,
    target: () => target,
    clear() {
      if (initial !== target) initial.reset()
      target.reset()
      cleared = target.current()
    },
    retarget(next: PromptTarget) {
      input.context.forEach(next.context.add)
      target = next
    },
    current: (value: PromptTarget) => target === value,
    restore() {
      if (cleared !== undefined && target.current() !== cleared) return
      return { target, prompt: input.prompt, context: input.context }
    },
  }
}
