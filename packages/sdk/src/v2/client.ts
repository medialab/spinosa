export * from "./gen/types.gen.js"
export type { FileSystemEntry as LocationFileSystemEntry } from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
import { wrapClientError } from "../error-interceptor.js"
import { rewriteLocationRequest } from "../location.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

export function createSpinosaClient(config?: Config & { directory?: string; experimental_workspaceID?: string }) {
  if (!config?.fetch) {
    const customFetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (input instanceof Request) Object.assign(input, { timeout: false })
      return fetch(input, init)
    }) as unknown as typeof fetch
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-spinosa-directory": encodeURIComponent(config.directory),
    }
  }

  if (config?.experimental_workspaceID) {
    config.headers = {
      ...config.headers,
      "x-spinosa-workspace": config.experimental_workspaceID,
    }
  }

  const client = createClient(config)
  client.interceptors.request.use((request) =>
    rewriteLocationRequest(
      request,
      {
        directory: config?.directory,
        workspace: config?.experimental_workspaceID,
      },
      { includeWorkspace: true, includeApiLocationQueries: true },
    ),
  )
  client.interceptors.response.use((response) => {
    const contentType = response.headers.get("content-type")
    if (contentType === "text/html")
      throw new Error("Request is not supported by this version of Spinosa Server (Server responded with text/html)")

    return response
  })
  client.interceptors.error.use(wrapClientError)
  return new OpencodeClient({ client })
}
