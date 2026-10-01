import { expect, test } from "bun:test"
import { createSpinosaClient as createV1Client } from "../src/client"
import { createSpinosaClient as createV2Client } from "../src/v2/client"

const body = { name: "NotFoundError", data: { message: "No active onboarding job" } }

function notFoundResponse() {
  return new Response(JSON.stringify(body), {
    status: 404,
    headers: { "content-type": "application/json" },
  })
}

test("v1 client wraps HTTP errors when throwOnError comes from client config", async () => {
  const client = createV1Client({
    baseUrl: "http://spinosa.test",
    throwOnError: true,
    fetch: async () => notFoundResponse(),
  })

  const error = await client.session.get({ id: "ses_missing" }).catch((cause: unknown) => cause)

  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ message: body.data.message })
  expect((error as Error).cause).toMatchObject({ body, status: 404 })
})

test("v2 client wraps HTTP errors when throwOnError comes from client config", async () => {
  const client = createV2Client({
    baseUrl: "http://spinosa.test",
    throwOnError: true,
    fetch: async () => notFoundResponse(),
  })

  const error = await client.onboarding.active.get({ directory: "/workspace" }).catch((cause: unknown) => cause)

  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ message: body.data.message })
  expect((error as Error).cause).toMatchObject({ body, status: 404 })
})

test("per-request throwOnError takes precedence over client defaults", async () => {
  const client = createV2Client({
    baseUrl: "http://spinosa.test",
    throwOnError: true,
    fetch: async () => notFoundResponse(),
  })

  const result = await client.onboarding.active.get({ directory: "/workspace" }, { throwOnError: false })

  expect(result.error).toEqual(body)
})
