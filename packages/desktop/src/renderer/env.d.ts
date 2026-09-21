import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __SPINOSA__?: {
      deepLinks?: string[]
    }
  }
}
