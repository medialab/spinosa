import { createSignal, type JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import open from "open"
import { useTheme } from "../context/theme"
import { hoverLabelFg } from "../util/button"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
  bg?: RGBA
  width?: number | "auto" | `${number}%`
  wrapMode?: "word" | "none"
}

/**
 * Link component that renders clickable hyperlinks.
 * Clicking anywhere on the link text opens the URL in the default browser.
 */
export function Link(props: LinkProps) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const displayText = () => props.children ?? props.href

  return (
    <text
      fg={hoverLabelFg(theme, hover(), props.fg ?? theme.primary)}
      bg={props.bg}
      width={props.width}
      wrapMode={props.wrapMode}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        open(props.href).catch(() => {})
      }}
    >
      {displayText()}
    </text>
  )
}
