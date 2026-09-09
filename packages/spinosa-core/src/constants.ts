import path from "node:path"

export const MARKDOWN_EXTENSIONS = [
  "txt", "rtf", "textile", "wiki", "mediawiki", "dokuwiki", "pmwiki",
  "outliner", "workflowy", "dynalist", "yaml", "yml", "toml",
  "css", "js", "ts", "py", "rb", "sh", "log",
  "ini", "cfg", "conf", "tex", "bib", "org", "adoc", "rst",
  "tiddlywiki", "logseq", "roam", "obsidian",
]

export const NATIVE_EXTENSIONS = ["md"]

export const BINARY_COPYABLE_EXTENSIONS: string[] = [] // intentionally empty for now — extension point

// PowerPoint (.pptx) is intentionally omitted: markitdown-ts does not implement
// a PowerPoint converter and rejects with "The .pptx are not supported."
export const MARKITDOWN_EXTENSIONS = [
  "docx", "xlsx", "xls", "epub",
  "html", "htm", "msg", "zip", "json", "csv", "xml",
]

export const IMAGE_EXTENSIONS = [
  "jpg", "jpeg", "png", "webp",
]

export const AUDIO_VIDEO_EXTENSIONS = [
  "mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv",
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff",
]

export const SPINOSA_HOME = "~/.spinosa"
export const SPINOSA_METADATA_DIR = "~/.spinosa/metadata"
export const SPINOSA_REGISTRY = "workspaces.json"
export const SPINOSA_CONFIG = "config.yaml"
export const WORKSPACE_MARKER = ".spinosa/workspace"

export const SPINOSA_AGENT_FILES = [
  "spinosa-searcher.md",
  "spinosa-mapper.md",
  "spinosa-analyst.md",
  "spinosa-serendippo.md",
  "spinosa-writer.md",
  "spinosa-verifier.md",
  "spinosa-evaluator.md",
  "spinosa-evolver.md",
  "spinosa-janitor.md",
  "spinosa-overseer.md",
  "spinosa-visualizer.md",
]

const MAX_EXTENSION_FILENAME_LENGTH = 255

export function fileExt(filePath: string): string {
  try {
    if (typeof filePath !== "string" || filePath.trim() === "") return ""

    const baseName = path.basename(filePath).trim()
    if (!baseName || baseName === "." || baseName === "..") return ""

    const safeName =
      baseName.length > MAX_EXTENSION_FILENAME_LENGTH
        ? baseName.slice(-MAX_EXTENSION_FILENAME_LENGTH)
        : baseName

    const lastDot = safeName.lastIndexOf(".")
    if (lastDot <= 0 || lastDot === safeName.length - 1) return ""

    return safeName.slice(lastDot + 1).toLowerCase()
  } catch {
    return ""
  }
}

export function extInList(ext: string, list: string[]): boolean {
  return list.includes(ext.toLowerCase())
}
