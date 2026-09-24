import type { Part, UserMessage } from "./client.js"
import { randomUUID } from "node:crypto"

export const message = {
  user(
    input: Omit<UserMessage, "role" | "time" | "id"> & {
      parts: Omit<Part, "id" | "sessionID" | "messageID">[]
    },
  ): {
    info: UserMessage
    parts: Part[]
  } {
    const { parts: _parts, ...rest } = input

    const info: UserMessage = {
      ...rest,
      id: randomUUID(),
      time: {
        created: Date.now(),
      },
      role: "user",
    }

    return {
      info,
      parts: input.parts.map(
        (part) =>
          ({
            ...part,
            id: randomUUID(),
            messageID: info.id,
            sessionID: info.sessionID,
          }) as unknown as Part,
      ),
    }
  },
}
