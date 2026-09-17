import { createMemo, createSignal, onMount } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { DialogMcp } from "./dialog-mcp"
import {
  spinosaReleaseChannel,
  setReleaseChannel,
  readAutoUpgrade,
  setAutoUpgrade,
  type ReleaseChannel,
} from "@spinosa/core/system/channels"

type SettingsValue = "auto-on" | "auto-off" | "channel-beta" | "channel-stable" | "mcp"

export function DialogSpinosaSettings() {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [currentChannel, setCurrentChannel] = createSignal<ReleaseChannel>("beta")
  const [autoUpgrade, setAutoUpgradeEnabled] = createSignal(true)
  const [loaded, setLoaded] = createSignal(false)

  onMount(async () => {
    dialog.setSize("medium")
    const [ch, au] = await Promise.all([
      spinosaReleaseChannel().catch(() => "beta" as ReleaseChannel),
      readAutoUpgrade().catch(() => true),
    ])
    setCurrentChannel(ch)
    setAutoUpgradeEnabled(au)
    setLoaded(true)
  })

  const updateAutoUpgrade = async (enabled: boolean) => {
    try {
      await setAutoUpgrade(enabled)
      setAutoUpgradeEnabled(enabled)
      toast.show({
        variant: "success",
        message: enabled ? "Auto-upgrade enabled" : "Auto-upgrade disabled",
      })
    } catch {
      toast.show({
        variant: "error",
        title: "Settings update failed",
        message: "Could not save auto-upgrade setting.",
      })
    }
  }

  const updateChannel = async (channel: ReleaseChannel) => {
    await setReleaseChannel(channel)
    setCurrentChannel(channel)
    toast.show({
      variant: "success",
      message: `Release channel set to ${channel}`,
    })
  }

  const options = createMemo<DialogSelectOption<SettingsValue>[]>(() => [
    {
      title: "MCP servers",
      value: "mcp",
      description: "Enable or disable installed MCP servers.",
      category: "Integrations",
      onSelect: () => dialog.replace(() => <DialogMcp />),
    },
    {
      title: "Enable auto-upgrade",
      value: "auto-on",
      description: "Check for updates when launching Spinosa (default).",
      category: "Updates",
      gutter: autoUpgrade() ? () => <text fg={theme.success}>✓</text> : undefined,
      onSelect: () => void updateAutoUpgrade(true),
    },
    {
      title: "Disable auto-upgrade",
      value: "auto-off",
      description: "Skip launch-time update checks (writes auto_upgrade: false).",
      category: "Updates",
      gutter: !autoUpgrade() ? () => <text fg={theme.success}>✓</text> : undefined,
      onSelect: () => void updateAutoUpgrade(false),
    },
    {
      title: "Beta channel",
      value: "channel-beta",
      description: "Current development channel — receive the latest prerelease updates.",
      category: "Release Channel",
      gutter: currentChannel() === "beta" ? () => <text fg={theme.success}>✓</text> : undefined,
      onSelect: () => void updateChannel("beta"),
    },
    {
      title: "Stable channel",
      value: "channel-stable",
      description: "Production releases when published — stable rolling channel may be unavailable until then.",
      category: "Release Channel",
      gutter: currentChannel() === "stable" ? () => <text fg={theme.success}>✓</text> : undefined,
      onSelect: () => void updateChannel("stable"),
    },
  ])

  return (
    <DialogSelect
      title="Settings"
      renderFilter={false}
      options={loaded() ? options() : []}
      emptyView={<text>Loading settings\u2026</text>}
    />
  )
}
