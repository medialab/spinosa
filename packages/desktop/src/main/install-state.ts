export function hasExistingAppState(entries: Array<{ name: string; isDirectory: () => boolean }>) {
  return entries.some((entry) => {
    // "opencode.settings" covers state left by OpenCode Desktop installs.
    if (entry.name === "spinosa.settings" || entry.name === "opencode.settings") return true
    if (entry.name.endsWith(".dat")) return true
    if (/^window-state-.+\.json$/.test(entry.name)) return true
    // "opencode" covers state left by OpenCode Desktop installs; "spinosa" is this app's own partition.
    return entry.isDirectory() && (entry.name === "opencode" || entry.name === "spinosa")
  })
}
