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

/** Dismiss/link labels: rest color at rest, full text on hover. */
export function hoverLabelFg(theme: Theme, hover: boolean, rest: RGBA = theme.textMuted) {
  return hover ? theme.text : rest
}

/** Chip fill: optional accent (MD blue / PDF orange) instead of theme.text. */
export function chipBackground(theme: Theme, lit: boolean, opts?: { danger?: boolean; accent?: RGBA }) {
  if (opts?.accent) return lit ? opts.accent : theme.backgroundPanel
  return buttonBackground(theme, lit, opts?.danger)
}

export function chipText(
  theme: Theme,
  lit: boolean,
  opts?: { danger?: boolean; accent?: RGBA; inactiveFg?: RGBA },
) {
  if (opts?.accent) return lit ? selectedForeground(theme, opts.accent) : (opts.inactiveFg ?? opts.accent)
  return buttonText(theme, lit, opts?.inactiveFg, opts?.danger)
}
