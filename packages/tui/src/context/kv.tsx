import { createSignal, type Setter } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { Flock } from "@spinosa/kernel-core/util/flock"
import { Global } from "@spinosa/kernel-core/global"
import { readJson, writeJsonAtomic } from "../util/persistence"
import { useTuiPaths } from "./runtime"
import { bootLogError } from "@spinosa/kernel-core/observability/boot-log"
import path from "path"

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const paths = useTuiPaths()
    void Global.Path.state
    const file = path.join(paths.state, "kv.json")
    const lock = `tui-kv:${file}`
    const [ready, setReady] = createSignal(false)
  const [store, setStore] = createStore<Record<string, unknown>>()
    // Queue same-process writes so rapid updates persist in order.
    let write = Promise.resolve()

    Flock.withLock(lock, () => readJson<Record<string, unknown>>(file))
      .then((x) => {
        setStore(x)
      })
      .catch((error) => {
        bootLogError("tui.kv.read", error)
      })
      .finally(() => {
        setReady(true)
      })

    const result = {
      get ready() {
        return ready()
      },
      get store() {
        return store
      },
      signal<T>(name: string, defaultValue: T) {
        if (store[name] === undefined) setStore(name, defaultValue)
        return [
          function () {
          return result.get<T>(name) ?? defaultValue
          },
          function setter(next: Setter<T>) {
            result.set(name, next)
          },
        ] as const
      },
    get<T = unknown>(key: string, defaultValue?: T): T | undefined {
      const value = store[key]
      return (value === undefined ? defaultValue : value) as T | undefined
    },
    set<T>(key: string, value: T) {
        setStore(key, value)
        const snapshot = structuredClone(unwrap(store))
        write = write
          .then(() => Flock.withLock(lock, () => writeJsonAtomic(file, snapshot)))
          .catch((error) => {
            bootLogError("tui.kv.write", error)
          })
      },
    }
    return result
  },
})
