import { expect, test } from "bun:test"
import { DEFAULT_THEMES, resolveTheme } from "../../src/theme"
import { buttonBackground, buttonText, chipBackground, chipText, hoverLabelFg } from "../../src/util/button"

test("buttonText stays distinct from buttonBackground when active", () => {
  for (const mode of ["dark", "light"] as const) {
    const theme = resolveTheme(DEFAULT_THEMES.opencode, mode)
    const bg = buttonBackground(theme, true)
    const fg = buttonText(theme, true)
    expect(fg).not.toEqual(bg)
    expect(buttonText(theme, false, theme.text)).toEqual(theme.text)
  }
})

test("button helpers flip to selectedForeground on active text bg", () => {
  const theme = resolveTheme(DEFAULT_THEMES.opencode, "dark")
  expect(buttonBackground(theme, true)).toEqual(theme.text)
  expect(buttonText(theme, true)).toEqual(theme.selectedListItemText)
})

test("hoverLabelFg brightens muted labels and custom rest colors", () => {
  const theme = resolveTheme(DEFAULT_THEMES.opencode, "dark")
  expect(hoverLabelFg(theme, false)).toEqual(theme.textMuted)
  expect(hoverLabelFg(theme, true)).toEqual(theme.text)
  expect(hoverLabelFg(theme, false, theme.primary)).toEqual(theme.primary)
  expect(hoverLabelFg(theme, true, theme.primary)).toEqual(theme.text)
})

test("chip helpers fill an accent on hover and keep it as rest text", () => {
  const theme = resolveTheme(DEFAULT_THEMES.opencode, "dark")
  expect(chipBackground(theme, false, { accent: theme.warning })).toEqual(theme.backgroundPanel)
  expect(chipBackground(theme, true, { accent: theme.warning })).toEqual(theme.warning)
  expect(chipText(theme, false, { accent: theme.warning })).toEqual(theme.warning)
  expect(chipText(theme, true, { accent: theme.warning })).toEqual(theme.selectedListItemText)
})
