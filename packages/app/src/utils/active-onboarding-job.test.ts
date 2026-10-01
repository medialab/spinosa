import { expect, test } from "bun:test"
import { activeOnboardingJob } from "./active-onboarding-job"

test("returns the current onboarding job", async () => {
  const job = { id: "job_1", status: "running" }

  await expect(activeOnboardingJob(async () => ({ data: job }))).resolves.toEqual(job)
})

test("treats the typed not-found response as no active onboarding job", async () => {
  const notFound = new Error("NotFoundError", {
    cause: {
      body: { name: "NotFoundError", data: { message: "No active onboarding job" } },
      status: 404,
    },
  })

  await expect(activeOnboardingJob(async () => Promise.reject(notFound))).resolves.toBeUndefined()
})

test("handles a raw typed not-found body from older SDK clients", async () => {
  const notFound = { name: "NotFoundError", data: { message: "No active onboarding job" } }

  await expect(activeOnboardingJob(async () => Promise.reject(notFound))).resolves.toBeUndefined()
})

test("treats the kernel's tagged 404 as no active onboarding job", async () => {
  const notFound = new Error("Not Found", {
    cause: { body: { _tag: "NotFound" }, status: 404 },
  })

  await expect(activeOnboardingJob(async () => Promise.reject(notFound))).resolves.toBeUndefined()
})

test("does not hide unrelated HTTP errors", async () => {
  const unavailable = new Error("onboarding service unavailable", {
    cause: { body: { name: "ServiceUnavailableError" }, status: 503 },
  })

  await expect(activeOnboardingJob(async () => Promise.reject(unavailable))).rejects.toBe(unavailable)
})

test("does not treat other 404 responses as a missing active job", async () => {
  const missingRoute = new Error("Unknown route", {
    cause: { body: { message: "Unknown route" }, status: 404 },
  })

  await expect(activeOnboardingJob(async () => Promise.reject(missingRoute))).rejects.toBe(missingRoute)
})
