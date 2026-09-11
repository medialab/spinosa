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
      label: "Tesseract OCR",
      status: "checking",
      detail: "Scanned PDFs (ita+eng+fra, 300dpi)",
    },
    {
      label: "MarkItDown",
      status: "checking",
      detail: "Office docs, EPUB, HTML",
    },
    {
      label: "PDF.js",
      status: "checking",
      detail: "PDF text extraction and page rendering",
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
  return [
    {
      label: "Tesseract OCR",
      status: status.ocr
        ? "available"
        : status.ocrUnsupportedReason
          ? "unsupported"
          : "missing",
      detail: status.ocrUnsupportedReason ?? "Scanned PDFs (ita+eng+fra, 300dpi via pdftoppm + tesseract)",
    },
    {
      label: "MarkItDown",
      status: status.markitdown ? "available" : "missing",
      detail: "Office docs, EPUB, HTML",
    },
    {
      label: "PDF.js",
      status: status.pdfjs ? "available" : "missing",
      detail: "PDF text extraction and page rendering",
    },
  ];
}

export function toolActionLabel(checks: readonly ToolCheckResult[]): string {
  if (checks.length === 0) return "";
  if (checks.some((check) => check.status === "checking")) return "Checking...";
  if (checks.some((check) => check.status === "missing")) {
    // Tesseract is optional: vision-model and copy-as-is flows never touch
    // it, so its absence must not block the wizard behind a useless
    // reinstall loop. Any other missing tool still needs repair.
    if (onlyLocalOcrMissing(checks)) return "Continue without local OCR";
    return "Reinstall missing tools";
  }
  return "Scan source folders";
}

/**
 * True when every missing tool is local OCR (Tesseract). The OCR-engine
 * choice comes later in the wizard; users picking vision/none never need it.
 */
export function onlyLocalOcrMissing(checks: readonly ToolCheckResult[]): boolean {
  const missing = checks.filter((check) => check.status === "missing");
  return (
    missing.length > 0 &&
    missing.every((check) => check.label === "Tesseract OCR")
  );
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
    id: "tesseract-local",
    label: "Tesseract (offline)",
    detail: "Suitable for documents; handwritten quality may be poor · Scanned PDFs via pdftoppm + tesseract (ita+eng+fra, 300dpi) · images copied",
    kind: "tesseract",
    vision: false,
    cost: "offline",
  },
  {
    id: "vision:provider-picker",
    label: "Vision model (provider / model)",
    detail: "Choose a provider and a vision-capable model — images and scanned PDFs transcribed via SDK (needs API key, e.g. OPENROUTER_API_KEY)",
    kind: "vision",
    vision: true,
    cost: "paid",
  },
  {
    id: "none",
    label: "Don't OCR, just copy files as-is",
    detail: "Images and scanned PDFs copied to raw/ unchanged · no text extracted · no model needed",
    kind: "none",
    vision: false,
    cost: "offline",
  },
]

/** Short per-engine hints for the selector footer. Single source — the
    OcrModelSelector hint line composes from here, so copy can't drift. */
export const OCR_ENGINE_HINTS = {
  tesseract: "Tesseract: local PDFs (images copied)",
  vision: "Vision: SDK transcription (needs key)",
  none: "None: copy only",
} as const

export const OCR_ENGINE_HINT_LINE =
  `↑↓ move · space select · enter continue · ${OCR_ENGINE_HINTS.tesseract} · ${OCR_ENGINE_HINTS.vision} · ${OCR_ENGINE_HINTS.none}`
