import type { ElectronAPI, RendererDiagnostic } from "../preload/types"

type RendererDiagnosticBridge = Pick<Partial<ElectronAPI>, "recordRendererDiagnostic">

export function sendRendererDiagnostic(
  bridge: RendererDiagnosticBridge,
  diagnostic: RendererDiagnostic,
): Promise<void> {
  const record = bridge.recordRendererDiagnostic
  if (typeof record !== "function") return Promise.resolve()
  return record(diagnostic)
}
