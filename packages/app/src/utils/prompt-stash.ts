import { createStore } from "solid-js/store"

export type StashedPrompt = {
  id: string
  text: string
  time: number
}

const [store, setStore] = createStore<{ items: StashedPrompt[] }>({ items: [] })

const nextID = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

/** Client-side prompt stash: shelve composer text without sending it. */
export const promptStash = {
  list: () => store.items,
  push(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return undefined
    const item: StashedPrompt = { id: nextID(), text: trimmed, time: Date.now() }
    setStore("items", (items) => [item, ...items].slice(0, 50))
    return item
  },
  remove(id: string) {
    setStore("items", (items) => items.filter((item) => item.id !== id))
  },
  clear() {
    setStore("items", [])
  },
}
