import type { ResolvedTheme } from "./types"
import type { ThemeResolutionContext } from "./resolve-variant"
import { content, darkLight, modified, onColor, tone } from "./resolve-token-helpers"

function buildIconBaseTokens(context: ThemeResolutionContext, textTokens: ResolvedTheme): ResolvedTheme {
  const { colors, isDark, neutral } = context
  const tokens: ResolvedTheme = colors.compact && !isDark
    ? {
        "icon-base": textTokens["text-weak"],
        "icon-hover": textTokens["text-base"],
        "icon-active": textTokens["text-strong"],
        "icon-selected": textTokens["text-strong"],
        "icon-focus": textTokens["text-strong"],
      }
    : {
        "icon-base": tone(neutral, isDark, 9, 8),
        "icon-hover": neutral[10],
        "icon-active": neutral[11],
        "icon-selected": neutral[11],
        "icon-focus": neutral[11],
      }
  tokens["icon-disabled"] = tone(neutral, isDark, 6, 7)
  return tokens
}

export function buildIconTokens(context: ThemeResolutionContext, textTokens: ResolvedTheme): ResolvedTheme {
  const { amber, blue, diffAdd, diffDelete, error, info, interactive, isDark, neutral, primary, success, warning } = context
  const tokens = buildIconBaseTokens(context, textTokens)
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
  tokens["icon-invert-base"] = darkLight(isDark, neutral[0], "#ffffff")
  tokens["icon-weak-base"] = tone(neutral, isDark, 5, 6)
  tokens["icon-weak-hover"] = tone(neutral, isDark, 11, 7)
  tokens["icon-weak-active"] = neutral[8]
  tokens["icon-weak-selected"] = tone(neutral, isDark, 8, 9)
  tokens["icon-weak-disabled"] = tone(neutral, isDark, 3, 5)
  tokens["icon-weak-focus"] = neutral[8]
  tokens["icon-strong-base"] = neutral[11]
  tokens["icon-strong-hover"] = darkLight(isDark, "#f6f3f3", "#151313")
  tokens["icon-strong-active"] = darkLight(isDark, "#fcfcfc", "#020202")
  tokens["icon-strong-selected"] = darkLight(isDark, "#fdfcfc", "#020202")
  tokens["icon-strong-disabled"] = neutral[7]
  tokens["icon-strong-focus"] = darkLight(isDark, "#fdfcfc", "#020202")
  tokens["icon-brand-base"] = darkLight(isDark, "#ffffff", neutral[11])
  tokens["icon-interactive-base"] = interactive[8]
  tokens["icon-success-base"] = tone(success, isDark, 8, 6)
  tokens["icon-success-hover"] = success[9]
  tokens["icon-success-active"] = success[10]
  tokens["icon-warning-base"] = tone(amber, isDark, 8, 6)
  tokens["icon-warning-hover"] = amber[9]
  tokens["icon-warning-active"] = amber[10]
  tokens["icon-critical-base"] = tone(error, isDark, 8, 9)
  tokens["icon-critical-hover"] = error[9]
  tokens["icon-critical-active"] = error[10]
  tokens["icon-info-base"] = tone(info, isDark, 8, 6)
  tokens["icon-info-hover"] = tone(info, isDark, 9, 7)
  tokens["icon-info-active"] = info[10]
  tokens["icon-on-brand-base"] = onColor(context, brandb)
  tokens["icon-on-brand-hover"] = onColor(context, brandh)
  tokens["icon-on-brand-selected"] = onColor(context, brandh)
  tokens["icon-on-interactive-base"] = onColor(context, interb)
  tokens["icon-agent-plan-base"] = info[8]
  tokens["icon-agent-docs-base"] = amber[8]
  tokens["icon-agent-ask-base"] = blue[8]
  tokens["icon-agent-build-base"] = tone(interactive, isDark, 10, 8)
  tokens["icon-on-success-base"] = onColor(context, succb)
  tokens["icon-on-success-hover"] = onColor(context, succs)
  tokens["icon-on-success-selected"] = onColor(context, succs)
  tokens["icon-on-warning-base"] = onColor(context, warnb)
  tokens["icon-on-warning-hover"] = onColor(context, warns)
  tokens["icon-on-warning-selected"] = onColor(context, warns)
  tokens["icon-on-critical-base"] = onColor(context, critb)
  tokens["icon-on-critical-hover"] = onColor(context, crits)
  tokens["icon-on-critical-selected"] = onColor(context, crits)
  tokens["icon-on-info-base"] = onColor(context, infob)
  tokens["icon-on-info-hover"] = onColor(context, infos)
  tokens["icon-on-info-selected"] = onColor(context, infos)
  tokens["icon-diff-add-base"] = diffAdd[10]
  tokens["icon-diff-add-hover"] = tone(diffAdd, isDark, 9, 11)
  tokens["icon-diff-add-active"] = tone(diffAdd, isDark, 10, 11)
  tokens["icon-diff-delete-base"] = diffDelete[9]
  tokens["icon-diff-delete-hover"] = diffDelete[10]
  tokens["icon-diff-modified-base"] = modified(context)
  return tokens
}

function buildCompactSyntaxTokens(
  context: ThemeResolutionContext,
  textTokens: ResolvedTheme,
  borderTokens: ResolvedTheme,
): ResolvedTheme {
  const { accent, amber, colors, diffAdd, diffDelete, error, info, interactive, isDark, primary, success, warning } = context
  const tokens: ResolvedTheme = {}
  tokens["syntax-comment"] = "var(--text-weak)"
  tokens["syntax-regexp"] = "var(--text-base)"
  tokens["syntax-string"] = content(context, colors.success, success)
  tokens["syntax-keyword"] = content(context, colors.accent, accent)
  tokens["syntax-primitive"] = content(context, colors.primary, primary)
  tokens["syntax-operator"] = isDark ? "var(--text-weak)" : "var(--text-base)"
  tokens["syntax-variable"] = "var(--text-strong)"
  tokens["syntax-property"] = content(context, colors.info, info)
  tokens["syntax-type"] = content(context, colors.warning, warning)
  tokens["syntax-constant"] = content(context, colors.accent, accent)
  tokens["syntax-punctuation"] = isDark ? "var(--text-weak)" : "var(--text-base)"
  tokens["syntax-object"] = "var(--text-strong)"
  tokens["syntax-success"] = success[10]
  tokens["syntax-warning"] = amber[10]
  tokens["syntax-critical"] = error[10]
  tokens["syntax-info"] = content(context, colors.info, info)
  tokens["syntax-diff-add"] = diffAdd[10]
  tokens["syntax-diff-delete"] = diffDelete[10]
  tokens["syntax-diff-unknown"] = "#ff0000"
  tokens["markdown-heading"] = content(context, colors.primary, primary)
  tokens["markdown-text"] = textTokens["text-base"]
  tokens["markdown-link"] = content(context, colors.interactive, interactive)
  tokens["markdown-link-text"] = content(context, colors.info, info)
  tokens["markdown-code"] = content(context, colors.success, success)
  tokens["markdown-block-quote"] = content(context, colors.warning, warning)
  tokens["markdown-emph"] = content(context, colors.warning, warning)
  tokens["markdown-strong"] = content(context, colors.accent, accent)
  tokens["markdown-horizontal-rule"] = borderTokens["border-base"]
  tokens["markdown-list-item"] = content(context, colors.interactive, interactive)
  tokens["markdown-list-enumeration"] = content(context, colors.info, info)
  tokens["markdown-image"] = content(context, colors.interactive, interactive)
  tokens["markdown-image-text"] = content(context, colors.info, info)
  tokens["markdown-code-block"] = textTokens["text-base"]
  return tokens
}

function buildSeedSyntaxTokens(context: ThemeResolutionContext): ResolvedTheme {
  const { amber, diffAdd, diffDelete, error, info, isDark, primary, success, warning } = context
  const tokens: ResolvedTheme = {}
  tokens["syntax-comment"] = "var(--text-weak)"
  tokens["syntax-regexp"] = "var(--text-base)"
  tokens["syntax-string"] = darkLight(isDark, "#00ceb9", "#006656")
  tokens["syntax-keyword"] = "var(--text-weak)"
  tokens["syntax-primitive"] = darkLight(isDark, "#ffba92", "#fb4804")
  tokens["syntax-operator"] = darkLight(isDark, "var(--text-weak)", "var(--text-base)")
  tokens["syntax-variable"] = "var(--text-strong)"
  tokens["syntax-property"] = darkLight(isDark, "#ff9ae2", "#ed6dc8")
  tokens["syntax-type"] = darkLight(isDark, "#ecf58c", "#596600")
  tokens["syntax-constant"] = darkLight(isDark, "#93e9f6", "#007b80")
  tokens["syntax-punctuation"] = darkLight(isDark, "var(--text-weak)", "var(--text-base)")
  tokens["syntax-object"] = "var(--text-strong)"
  tokens["syntax-success"] = success[10]
  tokens["syntax-warning"] = amber[10]
  tokens["syntax-critical"] = error[10]
  tokens["syntax-info"] = darkLight(isDark, "#93e9f6", "#0092a8")
  tokens["syntax-diff-add"] = diffAdd[10]
  tokens["syntax-diff-delete"] = diffDelete[10]
  tokens["syntax-diff-unknown"] = "#ff0000"
  tokens["markdown-heading"] = darkLight(isDark, "#9d7cd8", "#d68c27")
  tokens["markdown-text"] = darkLight(isDark, "#eeeeee", "#1a1a1a")
  tokens["markdown-link"] = darkLight(isDark, "#fab283", "#3b7dd8")
  tokens["markdown-link-text"] = darkLight(isDark, "#56b6c2", "#318795")
  tokens["markdown-code"] = darkLight(isDark, "#7fd88f", "#3d9a57")
  tokens["markdown-block-quote"] = darkLight(isDark, "#e5c07b", "#b0851f")
  tokens["markdown-emph"] = darkLight(isDark, "#e5c07b", "#b0851f")
  tokens["markdown-strong"] = darkLight(isDark, "#f5a742", "#d68c27")
  tokens["markdown-horizontal-rule"] = darkLight(isDark, "#808080", "#8a8a8a")
  tokens["markdown-list-item"] = darkLight(isDark, "#fab283", "#3b7dd8")
  tokens["markdown-list-enumeration"] = darkLight(isDark, "#56b6c2", "#318795")
  tokens["markdown-image"] = darkLight(isDark, "#fab283", "#3b7dd8")
  tokens["markdown-image-text"] = darkLight(isDark, "#56b6c2", "#318795")
  tokens["markdown-code-block"] = darkLight(isDark, "#eeeeee", "#1a1a1a")
  return tokens
}

export function buildSyntaxTokens(
  context: ThemeResolutionContext,
  textTokens: ResolvedTheme,
  borderTokens: ResolvedTheme,
): ResolvedTheme {
  return context.colors.compact
    ? buildCompactSyntaxTokens(context, textTokens, borderTokens)
    : buildSeedSyntaxTokens(context)
}

export function buildAvatarTokens(context: ThemeResolutionContext): ResolvedTheme {
  const { isDark } = context
  const tokens: ResolvedTheme = {}
  tokens["avatar-background-pink"] = darkLight(isDark, "#501b3f", "#feeef8")
  tokens["avatar-background-mint"] = darkLight(isDark, "#033a34", "#e1fbf4")
  tokens["avatar-background-orange"] = darkLight(isDark, "#5f2a06", "#fff1e7")
  tokens["avatar-background-purple"] = darkLight(isDark, "#432155", "#f9f1fe")
  tokens["avatar-background-cyan"] = darkLight(isDark, "#0f3058", "#e7f9fb")
  tokens["avatar-background-lime"] = darkLight(isDark, "#2b3711", "#eefadc")
  tokens["avatar-text-pink"] = darkLight(isDark, "#e34ba9", "#cd1d8d")
  tokens["avatar-text-mint"] = darkLight(isDark, "#95f3d9", "#147d6f")
  tokens["avatar-text-orange"] = darkLight(isDark, "#ff802b", "#ed5f00")
  tokens["avatar-text-purple"] = darkLight(isDark, "#9d5bd2", "#8445bc")
  tokens["avatar-text-cyan"] = darkLight(isDark, "#369eff", "#0894b3")
  tokens["avatar-text-lime"] = darkLight(isDark, "#c4f042", "#5d770d")
  return tokens
}
