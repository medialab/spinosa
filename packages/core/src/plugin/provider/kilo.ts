import { Effect } from "effect"
import { define } from "../define"

export const KiloPlugin = define({
  id: "kilo",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@ai-sdk/openai-compatible") continue
          if (item.provider.api.url !== "https://api.kilo.ai/api/gateway") continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.request.headers["HTTP-Referer"] = "https://github.com/medialab/spinosa"
            provider.request.headers["X-Title"] = "spinosa"
          })
        }
      }),
    )
  }),
})
