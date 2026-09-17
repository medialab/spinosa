type Definition = Record<string, (input: never) => void>

type MethodName<T extends Definition> = Extract<keyof T, string>

type RpcRequest<T extends Definition> = {
  type: "rpc.request"
  method: MethodName<T>
  input: never
  id: number
}

type RpcResult = {
  type: "rpc.result"
  result: never
  id: number
}

type RpcError = {
  type: "rpc.error"
  error: string
  id: number
}

type RpcEvent = {
  type: "rpc.event"
  event: string
  data: never
}

type RpcResponse = RpcResult | RpcError | RpcEvent

type RpcTarget = {
  postMessage: (data: string) => void | null
  onmessage:
    | ((this: Worker, ev: MessageEvent<string>) => void | Promise<void>)
    | null
}

export function listen<T extends Definition>(rpc: T) {
  onmessage = async (evt: MessageEvent<string>) => {
    const parsed = JSON.parse(evt.data) as RpcRequest<T>
    if (parsed.type === "rpc.request") {
      try {
        const result = await rpc[parsed.method](parsed.input)
        postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        postMessage(JSON.stringify({ type: "rpc.error", error: message, id: parsed.id }))
      }
    }
  }
}

export function emit<Data>(event: string, data: Data) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(target: RpcTarget) {
  const pending = new Map<
    number,
    { resolve: (result: never) => void; reject: (error: unknown) => void }
  >()
  const listeners = new Map<string, Set<(data: never) => void>>()
  let id = 0
  target.onmessage = async (evt: MessageEvent<string>) => {
    const parsed = JSON.parse(evt.data) as RpcResponse
    if (parsed.type === "rpc.result") {
      const waiter = pending.get(parsed.id)
      if (waiter) {
        waiter.resolve(parsed.result)
        pending.delete(parsed.id)
      }
    }
    if (parsed.type === "rpc.error") {
      const waiter = pending.get(parsed.id)
      if (waiter) {
        waiter.reject(new Error(parsed.error))
        pending.delete(parsed.id)
      }
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
        }
      }
    }
  }
  return {
    call<Method extends MethodName<T>>(
      method: Method,
      input: Parameters<T[Method]>[0],
    ): Promise<ReturnType<T[Method]>> {
      const { promise, resolve, reject } =
        Promise.withResolvers<ReturnType<T[Method]>>()
      const requestId = id++
      pending.set(requestId, { resolve, reject })
      try {
        target.postMessage(
          JSON.stringify({ type: "rpc.request", method, input, id: requestId }),
        )
      } catch (err) {
        pending.delete(requestId)
        reject(err)
      }
      return promise
    },
    failAll(error: unknown) {
      for (const waiter of pending.values()) waiter.reject(error)
      pending.clear()
    },
    on<Data>(event: string, handler: (data: Data) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers!.delete(handler)
      }
    },
  }
}

export * as Rpc from "./rpc"
