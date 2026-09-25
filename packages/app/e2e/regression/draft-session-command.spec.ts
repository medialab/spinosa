import { expect, test } from "../utils/diagnostic-test"
import { base64Encode } from "@spinosa/kernel-core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/DraftSessionCommand"
const sessionID = "ses_draft_session_command"

test("opens the session picker from a workspace draft with /session", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_draft_session_command",
      worktree: directory,
      vcs: "git",
      name: "draft-session-command",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [{
      id: sessionID,
      slug: "saved-conversation",
      projectID: "proj_draft_session_command",
      directory,
      title: "Saved conversation",
      version: "dev",
      time: { created: 1700000000000, updated: 1700000000000 },
    }],
    pageMessages: () => ({ items: [] }),
  })

  await page.goto(`/${base64Encode(directory)}/session`)
  const editor = page.locator('[data-component="prompt-input"][contenteditable="true"]')
  await expectAppVisible(editor)
  await editor.fill("/session")
  await expect(page.getByRole("button", { name: /\/session\s+COMMAND/ })).toBeVisible()
  await page.getByRole("button", { name: /\/session\s+COMMAND/ }).click()

  const picker = page.getByRole("dialog", { name: "Sessions" })
  await expect(picker).toBeVisible()
  await picker.getByRole("button", { name: /Saved conversation/ }).click()
  await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))

  await expectAppVisible(editor)
  await editor.fill("/sessions")
  await page.getByRole("button", { name: /\/sessions\s+COMMAND/ }).click()
  await expect(page.getByRole("dialog", { name: "Sessions" })).toBeVisible()
})
