# @spinosa/markitdown

Spinosa fork of [`markitdown-ts`](https://github.com/dead8309/markitdown-ts) (`0.0.10`), branched for seamless Spinosa integration (no external download).

**Why fork:** upstream `markitdown-ts` handled only `.jpg/.jpeg/.png` for vision LLM and used generic `Write a detailed caption` prompt; Spinosa corpus contains `webp/heic/tiff/bmp/svg/gif` and needs OCR-accurate transcription (`OCR_VISION_PROMPT`). Fork is vendored in `packages/spinosa-markitdown` and versioned `1.0.0-spinosa.x`, re-exported as `@spinosa/markitdown`.

**Spinosa patches:**
- `src/converters/image.ts` — `SPINOSA_IMAGE_EXTS` supports all `IMAGE_EXTENSIONS` (`jpg/jpeg/png/webp/heic/heif/tiff/tif/bmp/svg/gif`) when `llmModel` present; default prompt → `Transcribe all visible text… [illegible]` (see `packages/spinosa-core/src/import/vision-models.ts`).
- Branch: `feat/tesseract-pdf-copy-images` → `main` after merge. Upstream sync via `git subtree` or `git remote add markitdown-upstream`.

**Usage (same as upstream):**
```ts
import { MarkItDown } from "@spinosa/markitdown"
const md = new MarkItDown()
const res = await md.convert("path.jpg", { llmModel, llmPrompt: OCR_VISION_PROMPT })
```

**Build:** `bun run typecheck` (no bundle — src is imported directly via `workspace:*`).

See `packages/spinosa-core/src/import/markitdown-convert.ts` for Spinosa’s vision wiring.
