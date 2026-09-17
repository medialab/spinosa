const hooks: Array<() => Promise<void>> = []

export function registerTuiExitHook(hook: () => Promise<void>): () => void {
  hooks.push(hook)
  return () => {
    const index = hooks.indexOf(hook)
    if (index >= 0) hooks.splice(index, 1)
  }
}

export async function runTuiExitHooks(): Promise<void> {
  const pending = hooks.splice(0, hooks.length)
  await Promise.all(pending.map((hook) => hook().catch(() => {})))
}
