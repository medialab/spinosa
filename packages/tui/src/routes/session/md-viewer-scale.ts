export const MD_VIEWER_SCALE_MIN = 1
export const MD_VIEWER_SCALE_MAX = 5
export const MD_VIEWER_SCALE_DEFAULT = 3

export function clampMdViewerScale(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : MD_VIEWER_SCALE_DEFAULT
  return Math.min(MD_VIEWER_SCALE_MAX, Math.max(MD_VIEWER_SCALE_MIN, n))
}

/** Extra side padding at higher scale so the reader column is narrower. */
export function mdViewerSidePad(scale: unknown): number {
  return Math.max(0, (clampMdViewerScale(scale) - 1) * 2)
}

export function mdViewerTableCellPad(scale: unknown): number {
  return clampMdViewerScale(scale) >= 4 ? 1 : 0
}
