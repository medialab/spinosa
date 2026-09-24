import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const FRAMEWORK_MARKERS = [
  "workspace-template/.spinosa/workspace-files.tsv",
  ".spinosa/workspace-files.tsv",
  "framework/spinosa/framework-files.tsv",
]

export function resolveDevelopmentFrameworkRoot(appPath: string): string | undefined {
  let current = resolve(appPath)
  while (true) {
    if (FRAMEWORK_MARKERS.some((marker) => existsSync(join(current, marker)))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

export function withDevelopmentFrameworkRoot(
  env: Record<string, string>,
  appPath: string,
): Record<string, string> {
  if (env.SPINOSA_TEMPLATE_ROOT || env.SPINOSA_FRAMEWORK_ROOT) return env
  const root = resolveDevelopmentFrameworkRoot(appPath)
  return root ? { ...env, SPINOSA_TEMPLATE_ROOT: root } : env
}
