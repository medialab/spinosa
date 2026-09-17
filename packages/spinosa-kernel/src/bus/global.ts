import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

class GlobalBusEmitter extends EventEmitter<{
  event: [GlobalEvent]
}> {
  // Mirrors the base generic signature so the override stays assignable
  // across @types/node versions (the loose string|symbol form breaks on
  // newer typings where emit is generic over the event map key).
  override emit<K>(eventName: "event" | K, ...args: K extends "event" ? [GlobalEvent] : never): boolean {
    const event = (args as unknown[])[0] as GlobalEvent | undefined
    if (event?.payload && typeof event.payload === "object" && !("id" in event.payload)) {
      event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
    }
    return super.emit(eventName, ...args)
  }
}

export const GlobalBus = new GlobalBusEmitter()
