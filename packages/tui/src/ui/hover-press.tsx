import { createSignal } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { buttonBorder, chipBackground, chipText, hoverLabelFg } from "../util/button"

/** Clickable muted label (esc, edit, copy) that brightens on hover. */
export function HoverLabel(props: {
  onPress: () => void
  children: string
  bg?: RGBA
  attributes?: number
  restFg?: RGBA
}) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  return (
    <text
      fg={hoverLabelFg(theme, hover(), props.restFg)}
      bg={props.bg}
      attributes={props.attributes}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={props.onPress}
    >
      {props.children}
    </text>
  )
}

/** Action chip that fills on hover and/or keyboard selection. */
export function HoverChip(props: {
  onPress: () => void
  label: string
  active?: boolean
  danger?: boolean
  border?: boolean
  onHover?: () => void
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  inactiveFg?: RGBA
  flexShrink?: number
  accent?: RGBA
}) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const lit = () => Boolean(props.active) || hover()
  const fill = () => ({ danger: props.danger, accent: props.accent })
  return (
    <box
      flexShrink={props.flexShrink}
      paddingLeft={props.paddingLeft ?? 1}
      paddingRight={props.paddingRight ?? 1}
      paddingTop={props.paddingTop}
      paddingBottom={props.paddingBottom}
      backgroundColor={chipBackground(theme, lit(), fill())}
      border={props.border ? ["left"] : undefined}
      borderColor={props.border ? buttonBorder(theme, lit(), theme.borderActive, props.danger) : undefined}
      onMouseOver={() => {
        setHover(true)
        props.onHover?.()
      }}
      onMouseOut={() => setHover(false)}
      onMouseUp={props.onPress}
    >
      <text fg={chipText(theme, lit(), { ...fill(), inactiveFg: props.inactiveFg })}>{props.label}</text>
    </box>
  )
}
