import type { ColorValue, HexColor, ResolvedTheme } from "./types"
import type { ThemeResolutionContext } from "./resolve-variant"
import { blend, shift, withAlpha } from "./color"
import {
  borderTone,
  content,
  darkLight,
  modified,
  onColor,
  tone,
} from "./resolve-token-helpers"
import { buildAvatarTokens, buildIconTokens, buildSyntaxTokens } from "./resolve-token-semantic"

function buildBackgroundTokens(context: ThemeResolutionContext): ResolvedTheme {
  const { isDark, neutral } = context
  const tokens: ResolvedTheme = {}
  tokens["background-base"] = neutral[0]
  tokens["background-weak"] = neutral[2]
  tokens["background-strong"] = neutral[0]
  tokens["background-stronger"] = isDark ? neutral[1] : "#fcfcfc"

  return tokens
}

function buildSurfaceTokens(context: ThemeResolutionContext): ResolvedTheme {
  const { colors, diffAdd, diffDelete, diffHiddenSurface, error, info, interactive, isDark, neutral, neutralAlpha, primary, success, warning } = context
  const tokens: ResolvedTheme = {}
  const brandb = primary[8]
  const brandh = primary[9]
  const interb = tone(interactive, isDark, 6, 4)
  const interh = tone(interactive, isDark, 7, 5)
  const interw = tone(interactive, isDark, 5, 3)
  const succb = tone(success, isDark, 6, 4)
  const succw = tone(success, isDark, 5, 3)
  const succs = success[10]
  const warnb = tone(warning, isDark, 6, 4)
  const warnw = tone(warning, isDark, 5, 3)
  const warns = warning[10]
  const critb = tone(error, isDark, 6, 4)
  const critw = tone(error, isDark, 5, 3)
  const crits = error[10]
  const infob = tone(info, isDark, 6, 4)
  const infow = tone(info, isDark, 5, 3)
  const infos = info[10]
  tokens["surface-base"] = neutralAlpha[1]
  tokens["base"] = neutralAlpha[1]
  tokens["surface-base-hover"] = neutralAlpha[2]
  tokens["surface-base-active"] = neutralAlpha[2]
  tokens["surface-base-interactive-active"] = withAlpha(interactive[2], 0.3) as ColorValue
  tokens["base2"] = neutralAlpha[1]
  tokens["base3"] = neutralAlpha[1]
  tokens["surface-inset-base"] = neutralAlpha[1]
  tokens["surface-inset-base-hover"] = neutralAlpha[2]
  tokens["surface-inset-strong"] = isDark
    ? (withAlpha(neutral[0], 0.5) as ColorValue)
    : (withAlpha(neutral[3], 0.09) as ColorValue)
  tokens["surface-inset-strong-hover"] = tokens["surface-inset-strong"]
  tokens["surface-raised-base"] = neutralAlpha[0]
  tokens["surface-float-base"] = isDark ? neutral[1] : neutral[11]
  tokens["surface-float-base-hover"] = isDark ? neutral[2] : neutral[10]
  tokens["surface-raised-base-hover"] = neutralAlpha[1]
  tokens["surface-raised-base-active"] = neutralAlpha[2]
  tokens["surface-raised-strong"] = isDark ? neutralAlpha[3] : neutral[0]
  tokens["surface-raised-strong-hover"] = isDark ? neutralAlpha[5] : "#ffffff"
  tokens["surface-raised-stronger"] = isDark ? neutralAlpha[5] : "#ffffff"
  tokens["surface-raised-stronger-hover"] = isDark ? neutralAlpha[6] : "#ffffff"
  tokens["surface-weak"] = neutralAlpha[2]
  tokens["surface-weaker"] = neutralAlpha[3]
  tokens["surface-strong"] = isDark ? neutralAlpha[6] : "#ffffff"
  tokens["surface-raised-stronger-non-alpha"] = isDark ? neutral[2] : "#ffffff"

  tokens["surface-brand-base"] = brandb
  tokens["surface-brand-hover"] = brandh

  tokens["surface-interactive-base"] = interb
  tokens["surface-interactive-hover"] = interh
  tokens["surface-interactive-weak"] = interw
  tokens["surface-interactive-weak-hover"] = interb

  tokens["surface-success-base"] = succb
  tokens["surface-success-weak"] = succw
  tokens["surface-success-strong"] = succs
  tokens["surface-warning-base"] = warnb
  tokens["surface-warning-weak"] = warnw
  tokens["surface-warning-strong"] = warns
  tokens["surface-critical-base"] = critb
  tokens["surface-critical-weak"] = critw
  tokens["surface-critical-strong"] = crits
  tokens["surface-info-base"] = infob
  tokens["surface-info-weak"] = infow
  tokens["surface-info-strong"] = infos

  tokens["surface-diff-unchanged-base"] = tone([neutral[0], "#ffffff00"] as const, isDark, 0, 1)
  tokens["surface-diff-skip-base"] = tone([neutralAlpha[0], neutral[1]] as const, isDark, 0, 1)
  tokens["surface-diff-hidden-base"] = diffHiddenSurface.base
  tokens["surface-diff-hidden-weak"] = diffHiddenSurface.weak
  tokens["surface-diff-hidden-weaker"] = diffHiddenSurface.weaker
  tokens["surface-diff-hidden-strong"] = diffHiddenSurface.strong
  tokens["surface-diff-hidden-stronger"] = diffHiddenSurface.stronger
  tokens["surface-diff-add-base"] = diffAdd[2]
  tokens["surface-diff-add-weak"] = tone(diffAdd, isDark, 3, 1)
  tokens["surface-diff-add-weaker"] = tone(diffAdd, isDark, 2, 0)
  tokens["surface-diff-add-strong"] = diffAdd[4]
  tokens["surface-diff-add-stronger"] = tone(diffAdd, isDark, 10, 8)
  tokens["surface-diff-delete-base"] = diffDelete[2]
  tokens["surface-diff-delete-weak"] = tone(diffDelete, isDark, 3, 1)
  tokens["surface-diff-delete-weaker"] = tone(diffDelete, isDark, 2, 0)
  tokens["surface-diff-delete-strong"] = tone(diffDelete, isDark, 4, 5)
  tokens["surface-diff-delete-stronger"] = tone(diffDelete, isDark, 10, 8)

  return tokens
}

function buildInputTokens(context: ThemeResolutionContext): ResolvedTheme {
  const { interactive, isDark, neutral } = context
  const tokens: ResolvedTheme = {}
  tokens["input-base"] = tone(neutral, isDark, 1, 0)
  tokens["input-hover"] = tone(neutral, isDark, 2, 1)
  tokens["input-active"] = tone(interactive, isDark, 6, 0)
  tokens["input-selected"] = tone(interactive, isDark, 7, 3)
  tokens["input-focus"] = tone(interactive, isDark, 6, 0)
  tokens["input-disabled"] = neutral[3]

  return tokens
}

function buildTextTokens(context: ThemeResolutionContext): ResolvedTheme {
  const { body, colors, diffAdd, diffDelete, error, info, interactive, isDark, neutral, primary, success, warning } = context
  const tokens: ResolvedTheme = {}
  const brandb = primary[8]
  const brandh = primary[9]
  const interb = tone(interactive, isDark, 6, 4)
  const interh = tone(interactive, isDark, 7, 5)
  const succb = tone(success, isDark, 6, 4)
  const succs = success[10]
  const warnb = tone(warning, isDark, 6, 4)
  const warns = warning[10]
  const critb = tone(error, isDark, 6, 4)
  const crits = error[10]
  const infob = tone(info, isDark, 6, 4)
  const infos = info[10]
  tokens["text-base"] = colors.compact ? (body as HexColor) : neutral[10]
  tokens["text-weak"] = colors.compact ? shift(body as HexColor, { l: isDark ? -0.11 : 0.11, c: 0.9 }) : neutral[8]
  tokens["text-weaker"] = colors.compact
    ? shift(body as HexColor, { l: isDark ? -0.2 : 0.21, c: isDark ? 0.78 : 0.72 })
    : neutral[7]
  tokens["text-strong"] = colors.compact
    ? isDark
      ? blend("#ffffff", body as HexColor, 0.9)
      : shift(body as HexColor, { l: -0.07, c: 1.04 })
    : neutral[11]
  tokens["text-invert-base"] = tone(neutral, isDark, 10, 1)
  tokens["text-invert-weak"] = tone(neutral, isDark, 8, 2)
  tokens["text-invert-weaker"] = tone(neutral, isDark, 7, 3)
  tokens["text-invert-strong"] = tone(neutral, isDark, 11, 0)
  tokens["text-interactive-base"] = tone(interactive, isDark, 10, 9)
  tokens["text-on-brand-base"] = onColor(context, brandb)
  tokens["text-on-interactive-base"] = onColor(context, interb)
  tokens["text-on-interactive-weak"] = onColor(context, interb)
  tokens["text-on-success-base"] = onColor(context, succb)
  tokens["text-on-critical-base"] = onColor(context, critb)
  tokens["text-on-critical-weak"] = onColor(context, critb)
  tokens["text-on-critical-strong"] = onColor(context, crits)
  tokens["text-on-warning-base"] = onColor(context, warnb)
  tokens["text-on-info-base"] = onColor(context, infob)
  tokens["text-diff-add-base"] = diffAdd[10]
  tokens["text-diff-delete-base"] = diffDelete[9]
  tokens["text-diff-delete-strong"] = diffDelete[11]
  tokens["text-diff-add-strong"] = tone(diffAdd, isDark, 7, 11)
  tokens["text-on-info-weak"] = onColor(context, infob)
  tokens["text-on-info-strong"] = onColor(context, infos)
  tokens["text-on-warning-weak"] = onColor(context, warnb)
  tokens["text-on-warning-strong"] = onColor(context, warns)
  tokens["text-on-success-weak"] = onColor(context, succb)
  tokens["text-on-success-strong"] = onColor(context, succs)
  tokens["text-on-brand-weak"] = onColor(context, brandb)
  tokens["text-on-brand-weaker"] = onColor(context, brandb)
  tokens["text-on-brand-strong"] = onColor(context, brandh)

  return tokens
}

function buildButtonTokens(context: ThemeResolutionContext): ResolvedTheme {
  const { isDark, neutral, neutralAlpha } = context
  const tokens: ResolvedTheme = {}
  tokens["button-primary-base"] = neutral[11]
  tokens["button-secondary-base"] = isDark ? neutral[2] : neutral[0]
  tokens["button-secondary-hover"] = isDark ? neutral[3] : neutral[1]
  tokens["button-ghost-hover"] = neutralAlpha[1]
  tokens["button-ghost-hover2"] = neutralAlpha[2]

  return tokens
}

function buildCompactBorderTokens(context: ThemeResolutionContext): ResolvedTheme {
  const tokens: ResolvedTheme = {}
  tokens["border-base"] = borderTone(context, 0.22, 0.16)
  tokens["border-hover"] = borderTone(context, 0.28, 0.2)
  tokens["border-active"] = borderTone(context, 0.34, 0.24)
  tokens["border-disabled"] = borderTone(context, 0.18, 0.12)
  tokens["border-focus"] = borderTone(context, 0.34, 0.24)
  tokens["border-weak-base"] = borderTone(context, 0.1, 0.08)
  tokens["border-strong-base"] = borderTone(context, 0.34, 0.24)
  tokens["border-strong-hover"] = borderTone(context, 0.4, 0.28)
  tokens["border-strong-active"] = borderTone(context, 0.46, 0.32)
  tokens["border-strong-disabled"] = borderTone(context, 0.14, 0.1)
  tokens["border-strong-focus"] = borderTone(context, 0.46, 0.32)
  tokens["border-weak-hover"] = borderTone(context, 0.16, 0.12)
  tokens["border-weak-active"] = borderTone(context, 0.22, 0.16)
  tokens["border-weak-disabled"] = borderTone(context, 0.08, 0.06)
  tokens["border-weak-focus"] = borderTone(context, 0.22, 0.16)
  tokens["border-weaker-base"] = borderTone(context, 0.06, 0.04)
  return tokens
}

function buildStandardBorderTokens(context: ThemeResolutionContext): ResolvedTheme {
  const { isDark, neutralAlpha } = context
  const tokens: ResolvedTheme = {}
  tokens["border-base"] = neutralAlpha[6]
  tokens["border-hover"] = neutralAlpha[7]
  tokens["border-active"] = neutralAlpha[8]
  tokens["border-disabled"] = neutralAlpha[7]
  tokens["border-focus"] = neutralAlpha[8]
  tokens["border-weak-base"] = tone(neutralAlpha, isDark, 5, 4)
  tokens["border-strong-base"] = tone(neutralAlpha, isDark, 7, 6)
  tokens["border-strong-hover"] = neutralAlpha[7]
  tokens["border-strong-active"] = tone(neutralAlpha, isDark, 7, 6)
  tokens["border-strong-disabled"] = neutralAlpha[5]
  tokens["border-strong-focus"] = tone(neutralAlpha, isDark, 7, 6)
  tokens["border-weak-hover"] = tone(neutralAlpha, isDark, 6, 5)
  tokens["border-weak-active"] = tone(neutralAlpha, isDark, 7, 6)
  tokens["border-weak-disabled"] = neutralAlpha[5]
  tokens["border-weak-focus"] = tone(neutralAlpha, isDark, 7, 6)
  tokens["border-weaker-base"] = neutralAlpha[2]
  return tokens
}

function buildBorderTokens(context: ThemeResolutionContext): ResolvedTheme {
  const { error, info, interactive, isDark, neutral, success, warning } = context
  const tokens = context.colors.compact ? buildCompactBorderTokens(context) : buildStandardBorderTokens(context)
  tokens["border-selected"] = withAlpha(interactive[8], isDark ? 0.9 : 0.99) as ColorValue
  tokens["border-strong-selected"] = withAlpha(interactive[5], 0.6) as ColorValue
  tokens["border-weak-selected"] = withAlpha(interactive[4], isDark ? 0.6 : 0.5) as ColorValue

  tokens["border-interactive-base"] = interactive[6]
  tokens["border-interactive-hover"] = interactive[7]
  tokens["border-interactive-active"] = interactive[8]
  tokens["border-interactive-selected"] = interactive[8]
  tokens["border-interactive-disabled"] = neutral[7]
  tokens["border-interactive-focus"] = interactive[8]

  tokens["border-success-base"] = success[6]
  tokens["border-success-hover"] = success[7]
  tokens["border-success-selected"] = success[8]
  tokens["border-warning-base"] = warning[6]
  tokens["border-warning-hover"] = warning[7]
  tokens["border-warning-selected"] = warning[8]
  tokens["border-critical-base"] = error[6]
  tokens["border-critical-hover"] = error[7]
  tokens["border-critical-selected"] = error[8]
  tokens["border-info-base"] = info[6]
  tokens["border-info-hover"] = info[7]
  tokens["border-info-selected"] = info[8]
  tokens["border-color"] = "#ffffff"

  return tokens
}

function applyOverrides(tokens: ResolvedTheme, context: ThemeResolutionContext): void {
  const { colors, isDark, overrides } = context
  for (const [key, value] of Object.entries(overrides)) {
    tokens[key] = value
  }

  if (colors.compact && "text-weak" in overrides && !("text-weaker" in overrides)) {
    const weak = tokens["text-weak"]
    if (weak.startsWith("#")) {
      tokens["text-weaker"] = shift(weak as HexColor, { l: isDark ? -0.12 : 0.12, c: 0.75 })
    } else {
      tokens["text-weaker"] = weak
    }
  }

  if (colors.compact) {
    if (!("markdown-text" in overrides)) {
      tokens["markdown-text"] = tokens["text-base"]
    }
    if (!("markdown-code-block" in overrides)) {
      tokens["markdown-code-block"] = tokens["text-base"]
    }
  }

  if (!("text-stronger" in overrides)) {
    tokens["text-stronger"] = tokens["text-strong"]
  }

}
function mergeTokenGroups(groups: readonly ResolvedTheme[]): ResolvedTheme {
  const tokens: ResolvedTheme = {}
  for (const group of groups) Object.assign(tokens, group)
  return tokens
}
export function buildThemeTokens(context: ThemeResolutionContext): ResolvedTheme {
  const background = buildBackgroundTokens(context)
  const surface = buildSurfaceTokens(context)
  const input = buildInputTokens(context)
  const text = buildTextTokens(context)
  const button = buildButtonTokens(context)
  const border = buildBorderTokens(context)
  const icon = buildIconTokens(context, text)
  const syntax = buildSyntaxTokens(context, text, border)
  const avatar = buildAvatarTokens(context)
  const tokens = mergeTokenGroups([background, surface, input, text, button, border, icon, syntax, avatar])
  applyOverrides(tokens, context)
  return tokens
}
