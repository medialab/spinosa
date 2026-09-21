/**
 * Desktop sidecar entry. Bundled for plain Node (Electron utilityProcess)
 * by `scripts/build-server.ts` and loaded in `src/main/sidecar.ts` via the
 * `virtual:spinosa-server` module. Only what the sidecar needs is exported
 * so the bundle stays free of TUI/OpenTUI code.
 */
export { Server } from "@spinosa/kernel/server/server"
