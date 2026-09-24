import { describe, expect, test } from "bun:test"
import { defaultSpinosaAddFilesExtensions } from "./dialog-spinosa-add-files"

describe("defaultSpinosaAddFilesExtensions", () => {
  test("selects document types by default and leaves media types opt-in", () => {
    expect(
      defaultSpinosaAddFilesExtensions([
        { ext: "md" },
        { ext: "pdf" },
        { ext: "mp3" },
        { ext: "mp4" },
      ]),
    ).toEqual(["md", "pdf"])
  })
})
