import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "ai.spinosa.desktop" : `ai.spinosa.desktop.${channel}`
const productName = channel === "prod" ? "Spinosa" : `Spinosa ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `Local research workspace with verified AI answers${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="org.spinosa">
    <name>médialab Sciences Po</name>
  </developer>

  <description>
    <p>
      Spinosa is a local research workspace for people who work with document collections. AI agents search your files, draft answers, and verify every claim against the original text.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/medialab/spinosa/issues</url>
  <url type="homepage">https://medialab.github.io/spinosa/</url>
  <url type="vcs-browser">https://github.com/medialab/spinosa</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
