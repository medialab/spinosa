import type { DesktopTheme, ResolvedTheme, ThemeVariant } from "./types"
import { resolveThemeVariantImpl } from "./resolve-variant"

export function resolveThemeVariant(variant: ThemeVariant, isDark: boolean): ResolvedTheme {
  return resolveThemeVariantImpl(variant, isDark)
}

export function resolveTheme(theme: DesktopTheme): { light: ResolvedTheme; dark: ResolvedTheme } {
  return {
    light: resolveThemeVariant(theme.light, false),
    dark: resolveThemeVariant(theme.dark, true),
  }
}

export function themeToCss(tokens: ResolvedTheme): string {
  return Object.entries(tokens)
    .map(([key, value]) => `--${key}: ${value};`)
    .join("\n  ")
}
