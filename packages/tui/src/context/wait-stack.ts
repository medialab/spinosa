export function pushWaitLabel(stack: readonly string[], label: string): string[] {
  return [...stack, label]
}

export function popWaitLabel(stack: readonly string[]): string[] {
  return stack.slice(0, -1)
}

export function currentWaitLabel(stack: readonly string[]): string | undefined {
  return stack.at(-1)
}
