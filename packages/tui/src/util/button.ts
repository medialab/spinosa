import type { RGBA } from "@opentui/core"
import { selectedForeground, type Theme } from "../context/theme"

export function buttonBackground(theme: Theme, active: boolean, danger = false) {
  if (danger) return active ? theme.error : theme.backgroundPanel
  return active ? theme.text : theme.backgroundPanel
}

export function buttonBorder(theme: Theme, active: boolean, inactive: RGBA = theme.border, danger = false) {
  if (danger) return active ? theme.error : theme.error
  return active ? theme.text : inactive
}

export function buttonText(theme: Theme, active: boolean, inactive: RGBA = theme.textMuted, danger = false) {
  if (danger) return active ? selectedForeground(theme, theme.error) : theme.error
  return active ? selectedForeground(theme, theme.text) : inactive
}
