import type { ColorValue, HexColor, ThemeVariant, ResolvedTheme } from "./types"
import { blend, generateNeutralScale, generateScale, hexToOklch, shift, withAlpha } from "./color"
import { buildThemeTokens } from "./resolve-tokens"

export interface ThemeColors {
  compact: boolean
  neutral: HexColor
  ink?: HexColor
  primary: HexColor
  accent: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  interactive: HexColor
  diffAdd?: HexColor
  diffDelete?: HexColor
}

interface AlphaValues {
  base: number
  weak: number
  weaker: number
  strong: number
  stronger: number
}

export interface ThemeResolutionContext {
  colors: ThemeColors
  isDark: boolean
  overrides: Record<string, ColorValue>
  neutral: HexColor[]
  primary: HexColor[]
  accent: HexColor[]
  success: HexColor[]
  warning: HexColor[]
  error: HexColor[]
  info: HexColor[]
  interactive: HexColor[]
  amber: HexColor[]
  blue: HexColor[]
  diffAdd: HexColor[]
  diffDelete: HexColor[]
  neutralAlpha: HexColor[]
  body?: HexColor
  background: HexColor
  overlay: boolean
  diffHiddenSurface: Record<"base" | "weak" | "weaker" | "strong" | "stronger", ColorValue>
}

function getColors(variant: ThemeVariant): ThemeColors {
  const palette = variant.palette
  const seeds = variant.seeds
  if (palette && seeds) {
    throw new Error("Theme variant cannot define both `palette` and `seeds`")
  }

  if (palette) {
    return {
      compact: true,
      neutral: palette.neutral,
      ink: palette.ink,
      primary: palette.primary,
      accent: palette.accent ?? palette.info,
      success: palette.success,
      warning: palette.warning,
      error: palette.error,
      info: palette.info,
      interactive: palette.interactive ?? palette.primary,
      diffAdd: palette.diffAdd,
      diffDelete: palette.diffDelete,
    }
  }

  if (seeds) {
    return {
      compact: false,
      neutral: seeds.neutral,
      ink: undefined,
      primary: seeds.primary,
      accent: seeds.info,
      success: seeds.success,
      warning: seeds.warning,
      error: seeds.error,
      info: seeds.info,
      interactive: seeds.interactive,
      diffAdd: seeds.diffAdd,
      diffDelete: seeds.diffDelete,
    }
  }

  throw new Error("Theme variant requires `palette` or `seeds`")
}

function generateNeutralAlphaScale(neutralScale: HexColor[], isDark: boolean): HexColor[] {
  const alphas = isDark
    ? [0.038, 0.066, 0.1, 0.142, 0.19, 0.252, 0.334, 0.446, 0.58, 0.718, 0.854, 0.985]
    : [0.03, 0.06, 0.1, 0.145, 0.2, 0.265, 0.35, 0.47, 0.61, 0.74, 0.86, 0.97]
  return alphas.map((alpha) => blend(neutralScale[11], neutralScale[0], alpha))
}

function getHex(value: ColorValue | undefined): HexColor | undefined {
  if (!value?.startsWith("#")) return
  return value as HexColor
}

export function resolveThemeVariantImpl(variant: ThemeVariant, isDark: boolean): ResolvedTheme {
  return buildThemeTokens(createThemeResolution(variant, isDark))
}

function createThemeResolution(variant: ThemeVariant, isDark: boolean): ThemeResolutionContext {
  const colors = getColors(variant)
  const overrides = variant.overrides ?? {}
  const neutral = generateNeutralScale(colors.neutral, isDark, colors.ink)
  const primary = generateScale(colors.primary, isDark)
  const accent = generateScale(colors.accent, isDark)
  const success = generateScale(colors.success, isDark)
  const warning = generateScale(colors.warning, isDark)
  const error = generateScale(colors.error, isDark)
  const info = generateScale(colors.info, isDark)
  const interactive = generateScale(colors.interactive, isDark)
  const amber = generateScale(
    shift(colors.warning, isDark ? { h: -16, l: -0.058, c: 1.14 } : { h: -22, l: -0.082, c: 0.94 }),
    isDark,
  )
  const blue = generateScale(shift(colors.interactive, { h: -12, l: 0.128, c: 1.12 }), isDark)
  const diffAdd = generateScale(
    colors.diffAdd ?? shift(colors.success, { c: isDark ? 0.7 : 0.55, l: isDark ? -0.18 : 0.14 }),
    isDark,
  )
  const diffDelete = generateScale(
    colors.diffDelete ?? shift(colors.error, { c: isDark ? 0.82 : 0.7, l: isDark ? -0.08 : 0.08 }),
    isDark,
  )
  const ink = colors.ink ?? colors.neutral
  const tint = colors.compact ? hexToOklch(ink) : undefined
  const body = tint
    ? shift(ink, {
        l: isDark ? Math.max(0, 0.88 - tint.l) * 0.4 : -Math.max(0, tint.l - 0.18) * 0.24,
        c: isDark ? 1.04 : 1.02,
      })
    : undefined
  const backgroundOverride = overrides["background-base"]
  const backgroundHex = getHex(backgroundOverride)
  const overlay = Boolean(backgroundOverride) && !backgroundHex
  const background = backgroundHex ?? neutral[0]
  const alphaTone = createAlphaTone(background, overlay)
  const diffHiddenSurface = createSurface(
    isDark ? shift(colors.interactive, { c: 0.55, l: 0 }) : shift(colors.interactive, { c: 0.45, l: 0.08 }),
    alphaTone,
    isDark
      ? { base: 0.14, weak: 0.08, weaker: 0.18, strong: 0.26, stronger: 0.42 }
      : { base: 0.12, weak: 0.08, weaker: 0.16, strong: 0.24, stronger: 0.36 },
  )
  const neutralAlpha = generateNeutralAlphaScale(neutral, isDark)

  return {
    colors,
    isDark,
    overrides,
    neutral,
    primary,
    accent,
    success,
    warning,
    error,
    info,
    interactive,
    amber,
    blue,
    diffAdd,
    diffDelete,
    neutralAlpha,
    body,
    background,
    overlay,
    diffHiddenSurface,
  }
}

function createAlphaTone(background: HexColor, overlay: boolean): (color: HexColor, alpha: number) => ColorValue {
  return (color, alpha) => (overlay ? (withAlpha(color, alpha) as ColorValue) : blend(color, background, alpha))
}

function createSurface(
  seed: HexColor,
  alphaTone: (color: HexColor, alpha: number) => ColorValue,
  alpha: AlphaValues,
): Record<keyof AlphaValues, ColorValue> {
  return {
    base: alphaTone(seed, alpha.base),
    weak: alphaTone(seed, alpha.weak),
    weaker: alphaTone(seed, alpha.weaker),
    strong: alphaTone(seed, alpha.strong),
    stronger: alphaTone(seed, alpha.stronger),
  }
}
