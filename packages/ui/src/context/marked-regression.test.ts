import { expect, test } from "bun:test"
import { Marked } from "marked"
import { doubleTildeDel } from "./marked-parser"

test("preserves code spans adjacent to tildes", async () => {
  // Product renders through createMarkdownParser, which pins strikethrough to
  // GFM double tildes via doubleTildeDel. Test that configuration, not bare
  // marked (v17 treats a lone `~` as a delimiter and corrupts the span).
  const marked = new Marked(doubleTildeDel)

  expect(await marked.parse("~`0.1576` to measurement-window-only `0.00092`")).toBe(
    "<p>~<code>0.1576</code> to measurement-window-only <code>0.00092</code></p>\n",
  )
  expect(await marked.parse("`before`~`after`")).toBe("<p><code>before</code>~<code>after</code></p>\n")
  expect(await marked.parse("~~`deleted code`~~")).toBe("<p><del><code>deleted code</code></del></p>\n")
})
