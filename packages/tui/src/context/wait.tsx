import { createMemo, createSignal } from "solid-js"
import { createSimpleContext } from "./helper"
import { currentWaitLabel, popWaitLabel, pushWaitLabel } from "./wait-stack"

export const { use: useWait, provider: WaitProvider } = createSimpleContext({
  name: "Wait",
  init: () => {
    const [stack, setStack] = createSignal<string[]>([])
    const label = createMemo(() => currentWaitLabel(stack()))

    const begin = (text: string) => setStack((current) => pushWaitLabel(current, text))
    const end = () => setStack((current) => popWaitLabel(current))
    const withWait = async <T,>(text: string, work: () => Promise<T>): Promise<T> => {
      begin(text)
      try {
        return await work()
      } finally {
        end()
      }
    }

    return {
      label,
      begin,
      end,
      withWait,
    }
  },
})
