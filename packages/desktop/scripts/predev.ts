import { $ } from "bun"
import { buildServerBundle } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.SPINOSA_CHANNEL ?? "dev"}`

await buildServerBundle()
