import { isServerNotFoundError } from "@/utils/server-errors"

export async function activeOnboardingJob<T>(read: () => Promise<{ data: T }>): Promise<T | undefined> {
  try {
    return (await read()).data
  } catch (error) {
    if (isServerNotFoundError(error)) return undefined
    throw error
  }
}
