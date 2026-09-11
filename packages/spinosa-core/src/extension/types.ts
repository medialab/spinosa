import {
  MARKDOWN_EXTENSIONS,
  NATIVE_EXTENSIONS,
  MARKITDOWN_EXTENSIONS,
  IMAGE_EXTENSIONS,
  AUDIO_VIDEO_EXTENSIONS,
  BINARY_COPYABLE_EXTENSIONS,
} from "../constants"

export type FileClass =
  | "markdown"
  | "markitdown"
  | "native"
  | "ocr_convertible"
  | "video"
  | "audio"
  | "binary_copyable"
  | "ignored"
  | "unknown"

export type ImportRoute =
  | "markdown_rename"
  | "native_copy"
  | "media_copy"
  | "markitdown"
  | "vision"
  | "ocr"
  | "binary_copy"
  | "copy"

export type ImportBatch = { ext: string; count: number; bytes: number }

export {
  MARKDOWN_EXTENSIONS,
  NATIVE_EXTENSIONS,
  MARKITDOWN_EXTENSIONS,
  IMAGE_EXTENSIONS,
  AUDIO_VIDEO_EXTENSIONS,
  BINARY_COPYABLE_EXTENSIONS,
}
