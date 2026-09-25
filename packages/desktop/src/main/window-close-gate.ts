export function createWindowCloseGate(requestDecision: () => void) {
  let pending: Promise<boolean> | undefined
  let resolve: ((allowed: boolean) => void) | undefined

  return {
    request() {
      if (pending) return pending
      pending = new Promise<boolean>((done) => { resolve = done })
      try {
        requestDecision()
      } catch {
        const done = resolve
        pending = undefined
        resolve = undefined
        done?.(false)
        return Promise.resolve(false)
      }
      return pending
    },
    respond(allowed: boolean) {
      if (!resolve) return false
      const done = resolve
      pending = undefined
      resolve = undefined
      done(allowed)
      return true
    },
  }
}
