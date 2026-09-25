import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

const channels = [
  { channel: "dev", appId: "ai.spinosa.desktop.dev", productName: "Spinosa Dev" },
  { channel: "beta", appId: "ai.spinosa.desktop.beta", productName: "Spinosa Beta" },
  { channel: "prod", appId: "ai.spinosa.desktop", productName: "Spinosa" },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.SPINOSA_CHANNEL
    try {
      process.env.SPINOSA_CHANNEL = channel.channel
      const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
      const config = module.default as Configuration

      expect(config.appId).toBe(channel.appId)
      expect(config.productName).toBe(channel.productName)
      expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
      expect(config.linux?.executableName).toBe(channel.appId)
      expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
      expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
      expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    } finally {
      if (previous === undefined) delete process.env.SPINOSA_CHANNEL
      else process.env.SPINOSA_CHANNEL = previous
    }
  })
}

test("keeps the packaged resource contract stable", async () => {
  const module = await import("./electron-builder.config.ts?resources")
  const config = module.default as Configuration

  expect(config.files).toEqual(["out/**/*", "resources/**/*"])
  expect(config.extraResources).toContainEqual({
    from: "native/",
    to: "native/",
    filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
  })
  expect(config.mac?.target).toEqual(["dmg", "zip"])
  expect(config.linux?.target).toEqual(["AppImage", "deb", "rpm"])
})
