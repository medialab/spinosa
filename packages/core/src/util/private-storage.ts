import { chmodSync, mkdirSync } from "node:fs"

export function ensurePrivateDirectory(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}

export function protectPrivateFile(file: string) {
  if (file === ":memory:") return
  chmodSync(file, 0o600)
}
