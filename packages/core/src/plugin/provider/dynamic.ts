import { Effect } from "effect"
import { pathToFileURL } from "url"
import { define } from "../define"
import { Npm } from "../../npm"

export const DynamicProviderPlugin = define({
  id: "dynamic-provider",
  effect: Effect.fn(function* (ctx) {
    const npm = yield* Npm.Service
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.sdk) return

        const installedPath = evt.package.startsWith("file://")
          ? evt.package
          : (yield* npm.add(evt.package).pipe(Effect.orDie)).entrypoint
        if (!installedPath) throw new Error(`Package ${evt.package} has no import entrypoint`)

        const mod = yield* Effect.promise(async () => {
        return (await import(
          installedPath.startsWith("file://") ? installedPath : pathToFileURL(installedPath).href
        )) as Record<string, unknown>
        }).pipe(Effect.orDie)
        const match = Object.keys(mod).find((name) => name.startsWith("create"))
        if (!match) throw new Error(`Package ${evt.package} has no provider factory export`)

      const factory = mod[match]
      if (typeof factory !== "function") throw new Error(`Package ${evt.package} export ${match} is not a provider factory`)
      evt.sdk = factory(evt.options)
      }),
    )
  }),
})
