import { chmodSync } from "node:fs"

export const STORE_FILE_MODE = 0o600

/** Migrate existing settings files; configFileMode only applies to new writes. */
export function protectStoreFile(file: string) {
  try {
    chmodSync(file, STORE_FILE_MODE)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
}
