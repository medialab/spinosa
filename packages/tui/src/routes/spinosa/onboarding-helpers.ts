import { existsSync, readdirSync, statSync } from "node:fs";
import type { ImportOption, OcrModelOption } from "./wizard-ui";
import type { ToolCheckResult } from "./onboarding-view-types";

const WAVE_UNICODE = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
const WAVE_ASCII = ["_", "-", "~", "=", "#", "=", "~", "-"] as const;
// Locale-aware: dumb/linux/no-color terminals get ASCII waves.
const WAVE: readonly string[] = (() => {
  try {
    const term = (process.env.TERM ?? "").toLowerCase();
    if (term === "dumb" || term === "linux" || process.env.NO_COLOR !== undefined)
      return WAVE_ASCII as unknown as string[];
    const lang = (process.env.LANG ?? process.env.LC_ALL ?? "").toLowerCase();
    if (lang === "c" || lang === "posix") return WAVE_ASCII as unknown as string[];
    return WAVE_UNICODE as unknown as string[];
  } catch {
    return WAVE_UNICODE as unknown as string[];
  }
})();

export function validateSinglePath(value: string): "valid" | "invalid" {
  try {
    if (!existsSync(value)) return "invalid";
    const stats = statSync(value);
    if (stats.isFile()) return "valid";
    if (stats.isDirectory())
      return readdirSync(value).length > 0 ? "valid" : "invalid";
    return "invalid";
  } catch {
    return "invalid";
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function waveString(frame: number): string {
  let result = "";
  for (let index = 0; index < 6; index++) {
    const phase = (frame + index) % 14;
    result += WAVE[phase <= 6 ? phase : 13 - phase];
  }
  return result;
}

export function wavePulse(frame: number): string {
  const phase = frame % 14;
  return WAVE[phase <= 6 ? phase : 13 - phase];
}

export function waveRow(frame: number, width: number): string {
  let result = "";
  for (let index = 0; index < width; index++) {
    const angle = (index * Math.PI) / 7 + (frame * Math.PI) / 7;
    const level = Math.max(
      0,
      Math.min(7, Math.round(3.5 + 3.5 * Math.sin(angle))),
    );
    result += WAVE[level];
  }
  return result;
}

export function initialToolChecks(): ToolCheckResult[] {
  return [
    {
      label: "MarkItDown",
      status: "checking",
      detail: "Office docs, EPUB, HTML",
    },
    {
      label: "PDF.js",
      status: "checking",
      detail: "Text and pages from readable PDFs",
    },
  ];
}

export type DocumentToolStatus = {
  ocr: boolean;
  ocrUnsupportedReason?: string;
  markitdown: boolean;
  pdfjs: boolean;
};

export function toolCheckResults(
  status: DocumentToolStatus,
): ToolCheckResult[] {
  // No local OCR engine ships: no OCR row. Vision-model and
  // copy-as-is flows need nothing local; digital PDFs extract via pdf.js.
  return [
    {
      label: "MarkItDown",
      status: status.markitdown ? "available" : "missing",
      detail: "Office docs, EPUB, HTML",
    },
    {
      label: "PDF.js",
      status: status.pdfjs ? "available" : "missing",
      detail: "Text and pages from readable PDFs",
    },
  ];
}

export function toolActionLabel(checks: readonly ToolCheckResult[]): string {
  if (checks.length === 0) return "";
  if (checks.some((check) => check.status === "checking")) return "Checking...";
  if (checks.some((check) => check.status === "missing")) {
    return "Reinstall missing tools";
  }
  return "Scan source folders";
}

/**
 * Local OCR was removed, so no missing tool is ever a local-OCR wait.
 * Kept as a stub for import compat; always false.
 */
export function onlyLocalOcrMissing(checks: readonly ToolCheckResult[]): boolean {
  void checks;
  return false;
}

export function toolChecksReady(checks: readonly ToolCheckResult[]): boolean {
  return (
    checks.length > 0 &&
    checks.every(
      (check) => check.status === "available" || check.status === "unsupported",
    )
  );
}

export function mergeImportOptions(
  target: ImportOption[],
  options: readonly ImportOption[],
): ImportOption[] {
  for (const option of options) {
    const existing = target.find((item) => item.ext === option.ext);
    if (existing) {
      existing.count += option.count;
      existing.bytes += option.bytes;
    } else {
      target.push({ ...option });
    }
  }
  return target;
}

// Canonical option type lives in wizard-ui (single definition).
export type { OcrModelOption } from "./wizard-ui";

export const OCR_MODEL_OPTIONS: OcrModelOption[] = [
  {
    id: "vision:provider-picker",
    label: "Vision model (provider / model)",
    detail: "Paid online model. Needs internet and an API key. Transcribes scans and photos.",
    kind: "vision",
    vision: true,
    cost: "paid",
  },
  {
    id: "none",
    label: "Copy files only, no transcription",
    detail: "Copies scans and photos unchanged. No text and no search. Needs nothing.",
    kind: "none",
    vision: false,
    cost: "offline",
  },
]

/** Short per-engine hints for the selector footer. Single source — the
    OcrModelSelector hint line composes from here, so copy can't drift. */
export const OCR_ENGINE_HINTS = {
  vision: "Vision: paid online transcription (needs key)",
  none: "None: copy only",
} as const

export const OCR_ENGINE_HINT_LINE =
  `↑↓ move · space select · enter continue · ${OCR_ENGINE_HINTS.vision} · ${OCR_ENGINE_HINTS.none}`
