export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
import { wrapClientError } from "./error-interceptor.js"
import { rewriteLocationRequest } from "./location.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

export function createSpinosaClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    config = {
      ...config,
      fetch: (request: Request) => fetch(request),
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-spinosa-directory": encodeURIComponent(config.directory),
    }
  }

  const client = createClient(config)
  client.interceptors.request.use((request) =>
    rewriteLocationRequest(request, { directory: config?.directory }),
  )
  client.interceptors.error.use(wrapClientError)
  return new OpencodeClient({ client })
}
