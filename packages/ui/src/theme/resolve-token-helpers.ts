import type { ColorValue, HexColor } from "./types"
import type { ThemeResolutionContext } from "./resolve-variant"
import { blend, hexToOklch, hexToRgb, shift, withAlpha } from "./color"

export function content(context: ThemeResolutionContext, seed: HexColor, scale: HexColor[]): HexColor {
  const base = hexToOklch(seed)
  const value = context.isDark ? (base.l > 0.84 ? shift(seed, { c: 1.18 }) : scale[10]) : scale[10]
  return shift(value, { l: context.isDark ? 0.034 : -0.024, c: context.isDark ? 1.3 : 1.18 })
}

export function modified(context: ThemeResolutionContext): HexColor {
  if (!context.colors.compact) return context.isDark ? "#ffba92" : "#FF8C00"
  const warningHue = hexToOklch(context.colors.warning).h
  const deleteHue = hexToOklch(context.colors.diffDelete ?? context.colors.error).h
  const delta = Math.abs(((((deleteHue - warningHue) % 360) + 540) % 360) - 180)
  return delta < 48 ? (context.isDark ? "#ffba92" : "#FF8C00") : content(context, context.colors.warning, context.warning)
}

export function borderTone(context: ThemeResolutionContext, light: number, dark: number): ColorValue {
  const value = context.isDark ? Math.min(1, dark + 0.024 + (context.colors.compact ? 0.08 : 0)) : Math.min(1, light + 0.024)
  const seed = context.colors.ink ?? context.colors.neutral
  return context.overlay ? (withAlpha(seed, value) as ColorValue) : blend(seed, context.background, value)
}

export function luminance(hex: HexColor): number {
  const rgb = hexToRgb(hex)
  const lift = (value: number) => (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4))
  return 0.2126 * lift(rgb.r) + 0.7152 * lift(rgb.g) + 0.0722 * lift(rgb.b)
}

export function contrast(a: HexColor, b: HexColor): number {
  const x = luminance(a)
  const y = luminance(b)
  const light = Math.max(x, y)
  const dark = Math.min(x, y)
  return (light + 0.05) / (dark + 0.05)
}

export function onColor(context: ThemeResolutionContext, fill: HexColor): HexColor {
  const light = "#ffffff" as HexColor
  const dark = "#000000" as HexColor
  return contrast(light, fill) > contrast(dark, fill) ? light : dark
}

export function tone<T>(values: readonly T[], isDark: boolean, darkIndex: number, lightIndex: number): T {
  return values[isDark ? darkIndex : lightIndex]
}

export function darkLight<T>(isDark: boolean, dark: T, light: T): T {
  return isDark ? dark : light
}
