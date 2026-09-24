import type { Hooks, PluginInput } from "@spinosa/plugin"

/** Same id as `AUTH_ID` in `tool/jev.ts`. Kept local so this plugin does not import the tool module. */
const PROVIDER_ID = "typesafe"

export async function TypesafeAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: PROVIDER_ID,
      methods: [
        {
          type: "api",
          label: "TypeSafe API key",
        },
      ],
    },
  }
}
