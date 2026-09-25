import { describe, expect, test } from "bun:test"
import type { DesktopTheme, ResolvedTheme, ThemePaletteColors, ThemeSeedColors } from "./types"
import { resolveTheme, resolveThemeVariant, themeToCss } from "./resolve"
import oc2Theme from "./themes/oc-2.json"
import { resolveThemeVariantV2 } from "./v2/resolve"

const seeds: ThemeSeedColors = {
  neutral: "#6b7280",
  primary: "#2563eb",
  success: "#16a34a",
  warning: "#d97706",
  error: "#dc2626",
  info: "#0891b2",
  interactive: "#4f46e5",
  diffAdd: "#16a34a",
  diffDelete: "#dc2626",
}

const palette: ThemePaletteColors = {
  neutral: "#6b7280",
  ink: "#111827",
  primary: "#2563eb",
  success: "#16a34a",
  warning: "#d97706",
  error: "#dc2626",
  info: "#0891b2",
  interactive: "#4f46e5",
  diffAdd: "#16a34a",
  diffDelete: "#dc2626",
}

function expectCoreTokens(tokens: ResolvedTheme) {
  expect(tokens["background-base"]).toBeDefined()
  expect(tokens["surface-diff-add-base"]).toBeDefined()
  expect(tokens["surface-diff-delete-base"]).toBeDefined()
  expect(tokens["text-base"]).toBeDefined()
  expect(tokens["border-focus"]).toBeDefined()
  expect(tokens["icon-agent-build-base"]).toBeDefined()
  expect(tokens["syntax-string"]).toBeDefined()
  expect(tokens["markdown-code-block"]).toBeDefined()
  expect(tokens["avatar-text-cyan"]).toBeDefined()
}

describe("resolveThemeVariant", () => {
  test("resolves seed variants for both modes", () => {
    const light = resolveThemeVariant({ seeds }, false)
    const dark = resolveThemeVariant({ seeds }, true)

    expectCoreTokens(light)
    expectCoreTokens(dark)
    expect(light["syntax-string"]).toBe("#006656")
    expect(dark["syntax-string"]).toBe("#00ceb9")
    expect(light["background-base"]).not.toBe(dark["background-base"])
  })

  test("resolves compact palette fallbacks and overrides", () => {
    const tokens = resolveThemeVariant(
      {
        palette: { ...palette, accent: undefined, interactive: undefined, diffAdd: undefined, diffDelete: undefined },
        overrides: {
          "background-base": "var(--custom-background)",
          "text-weak": "#123456",
        },
      },
      true,
    )

    expectCoreTokens(tokens)
    expect(tokens["background-base"]).toBe("var(--custom-background)")
    expect(tokens["text-weak"]).toBe("#123456")
    expect(tokens["text-weaker"]).not.toBe("#123456")

    const lightTokens = resolveThemeVariant(
      {
        palette: { ...palette, accent: undefined, interactive: undefined, diffAdd: undefined, diffDelete: undefined },
      },
      false,
    )
    expect(lightTokens["icon-base"]).toBe(lightTokens["text-weak"])
    expect(lightTokens["icon-hover"]).toBe(lightTokens["text-base"])
    expect(lightTokens["icon-active"]).toBe(lightTokens["text-strong"])
    expect(lightTokens["icon-focus"]).toBe(lightTokens["text-strong"])
  })
})

describe("resolveTheme", () => {
  test("resolves light and dark variants without changing the public shape", () => {
    const theme: DesktopTheme = {
      name: "test",
      id: "test",
      light: { seeds },
      dark: { palette },
    }

    const resolved = resolveTheme(theme)

    expectCoreTokens(resolved.light)
    expectCoreTokens(resolved.dark)
    expect(resolved.light).toEqual(resolveThemeVariant(theme.light, false))
    expect(resolved.dark).toEqual(resolveThemeVariant(theme.dark, true))
  })
})

test("themeToCss serializes tokens in insertion order", () => {
  expect(themeToCss({ first: "#111111", second: "var(--second)" })).toBe(
    "--first: #111111;\n  --second: var(--second);",
  )
})

test("OC-2 light uses warm neutral surfaces and ink actions without changing status colors", () => {
  const light = resolveThemeVariant(oc2Theme.light as DesktopTheme["light"], false)
  const v2 = resolveThemeVariantV2(oc2Theme.light as DesktopTheme["light"], false)

  expect(light["background-base"]).toBe("#f5f5f5")
  expect(light["background-strong"]).toBe("#fafafa")
  expect(light["text-strong"]).toBe("#292524")
  expect(light["button-primary-base"]).toBe("#292524")
  expect(light["border-weak-base"]).toBe("#e7e5e4")
  expect(v2["v2-background-bg-base"]).toBe("var(--v2-grey-100)")
  expect(v2["v2-background-bg-deep"]).toBe("var(--v2-grey-200)")
  expect(v2["v2-grey-100"]).toBe("#f5f5f5ff")
  expect(v2["v2-blue-600"]).toBe("#3b5cf6ff")
  expect(v2["v2-state-fg-info"]).toBe("var(--v2-blue-800)")
  expect(oc2Theme.light.palette.error).toBe("#fc533a")
  expect(oc2Theme.light.palette.success).toBe("#12c905")

  const dark = resolveThemeVariant(oc2Theme.dark as DesktopTheme["dark"], true)
  expect(dark["background-base"]).toBe("#121212")
  expect(dark["button-primary-base"]).toBe("#ede8e4")
})
