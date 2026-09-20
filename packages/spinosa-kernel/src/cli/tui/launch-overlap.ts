export async function runOverlappedLaunch<TWorker>(input: {
  skipPreflight: boolean
  preflight: () => Promise<"continue" | "exit">
  spawn: () => TWorker
  stop: (worker: TWorker) => Promise<void>
}): Promise<{ status: "exit" } | { status: "continue"; worker: TWorker }> {
  const worker = input.spawn()
  if (input.skipPreflight) return { status: "continue", worker }
  try {
    const result = await input.preflight()
    if (result === "exit") {
      await input.stop(worker)
      return { status: "exit" }
    }
    return { status: "continue", worker }
  } catch (error) {
    await input.stop(worker)
    throw error
  }
}
