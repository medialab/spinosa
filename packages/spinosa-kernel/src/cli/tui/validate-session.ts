import { createSpinosaClient } from "@spinosa/sdk/v2"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"

const decodeSessionID = Schema.decodeUnknownSync(SessionID)

export async function validateSession(input: {
  url: string
  sessionID?: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  /** Injectable client for tests; defaults to a real SDK client. */
  client?: {
    session: {
      get(
        args: { sessionID: string },
        opts?: { throwOnError: boolean },
      ): Promise<{ data?: { directory?: unknown } | null; error?: unknown }>
    }
  }
}): Promise<{ directory?: string }> {
  if (!input.sessionID) return {}

  let sessionID: SessionID
  try {
    sessionID = decodeSessionID(input.sessionID)
  } catch (error) {
    throw new Error(`Invalid session ID: ${error instanceof Error ? error.message : "unknown error"}`, { cause: error })
  }

  const client = input.client ??
    createSpinosaClient({
      baseUrl: input.url,
      directory: input.directory,
      fetch: input.fetch,
      headers: input.headers,
    })
  const result = await client.session.get({ sessionID }, { throwOnError: true })
  const directory = result?.data && typeof result.data === "object" ? result.data.directory : undefined
  return typeof directory === "string" && directory.length > 0 ? { directory } : {}
}
