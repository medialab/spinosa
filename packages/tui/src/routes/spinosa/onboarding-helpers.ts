import { existsSync, readdirSync, statSync } from "node:fs";
import type { ImportOption } from "./wizard-ui";
import type { CliOption, ToolCheckResult } from "./onboarding-view-types";

const WAVE = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export const CLI_OPTIONS: CliOption[] = [
  {
    value: "spinosa",
    label: "Spinosa",
    description: "Open Spinosa TUI startup prompt ready.",
  },
  {
    value: "opencode",
    label: "Spinosa",
    description: "Run Spinosa CLI startup prompt.",
  },
  {
    value: "opencode_desktop",
    label: "Spinosa Desktop",
    description: "Open Spinosa paste copied prompt.",
  },
  {
    value: "gemini",
    label: "Gemini",
    description: "Run Gemini CLI in this workspace.",
  },
  {
    value: "qwen",
    label: "Qwen",
    description: "Run Qwen CLI in this workspace.",
  },
  {
    value: "claude_code",
    label: "Claude Code",
    description: "Run terminal CLI in this workspace.",
  },
  {
    value: "claude_code_desktop",
    label: "Claude Code Desktop",
    description: "Open desktop app prompt ready.",
  },
  {
    value: "codex",
    label: "Codex",
    description: "Run Codex terminal CLI in this workspace.",
  },
  {
    value: "codex_app",
    label: "Codex App",
    description: "Open Codex app paste copied prompt.",
  },
  {
    value: "hermes",
    label: "Hermes Agent",
    description: "Run Hermes CLI in this workspace.",
  },
  {
    value: "kilo",
    label: "Kilo",
    description: "Run Kilo terminal CLI in this workspace.",
  },
  {
    value: "other",
    label: "Other",
    description: "Copy generic launch command another tool.",
  },
];

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
      detail: "Office docs, EPUB, HTML, text PDFs",
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
      detail: "Office docs, EPUB, HTML, text PDFs",
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
  if (checks.some((check) => check.status === "missing"))
    return "Reinstall missing tools";
  return "Scan source folders";
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

export type OcrModelOption = {
  id: string
  label: string
  detail: string
  kind: "tesseract" | "vision" | "none"
  modelId?: string
  provider?: string
  vision: boolean
  cost?: "free" | "paid" | "offline"
  requiresKey?: string
}

export const OCR_MODEL_OPTIONS: OcrModelOption[] = [
  {
    id: "tesseract-local",
    label: "Tesseract (offline)",
    detail: "Scanned PDFs via pdftoppm + tesseract (ita+eng+fra, 300dpi) · images copied",
    kind: "tesseract",
    vision: false,
    cost: "offline",
  },
  {
    id: "openrouter/qwen2.5-vl-32b:free",
    label: "Qwen 2.5 VL 32B (free)",
    detail: "OpenRouter free · vision · images + scanned PDFs via LLM · needs OPENROUTER_API_KEY",
    kind: "vision",
    modelId: "qwen/qwen2.5-vl-32b-instruct:free",
    provider: "openrouter",
    vision: true,
    cost: "free",
    requiresKey: "OPENROUTER_API_KEY",
  },
  {
    id: "openrouter/gemini-flash-1.5-8b:free",
    label: "Gemini Flash 1.5 8B (free)",
    detail: "OpenRouter free · vision · images + scanned PDFs via LLM · needs OPENROUTER_API_KEY",
    kind: "vision",
    modelId: "google/gemini-flash-1.5-8b:free",
    provider: "openrouter",
    vision: true,
    cost: "free",
    requiresKey: "OPENROUTER_API_KEY",
  },
  {
    id: "none",
    label: "No OCR (copy only)",
    detail: "Images copied as-is · scanned PDFs skipped",
    kind: "none",
    vision: false,
    cost: "offline",
  },
]

export function defaultOcrModelId(): string {
  return "tesseract-local"
}

export function findOcrModel(id: string): OcrModelOption | undefined {
  return OCR_MODEL_OPTIONS.find((o) => o.id === id)
}
