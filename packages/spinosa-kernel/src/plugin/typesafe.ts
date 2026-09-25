import type { Hooks, PluginInput } from "@spinosa/plugin"

/** Provider id for TypeSafe auth. Kept local so this plugin does not import any tool module. */
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
