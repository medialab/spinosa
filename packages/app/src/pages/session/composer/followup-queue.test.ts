import { describe, expect, test } from "bun:test"
import { markFollowupSteered, nextQueuedFollowup, removeQueuedFollowup } from "./followup-queue"

describe("desktop follow-up queue", () => {
  const items = [{ id: "first" }, { id: "second" }, { id: "third" }]

  test("sends ordinary messages in FIFO order", () => {
    expect(nextQueuedFollowup(items)?.id).toBe("first")
  })

  test("first steered message goes next without changing visible order", () => {
    const firstSteer = markFollowupSteered(items, "third", 100)
    const secondSteer = markFollowupSteered(firstSteer, "second", 101)
    expect(secondSteer.map((item) => item.id)).toEqual(["first", "second", "third"])
    expect(nextQueuedFollowup(secondSteer)?.id).toBe("third")
    expect(markFollowupSteered(secondSteer, "third", 200)).toEqual(secondSteer)
  })

  test("removing a queued message never sends it", () => {
    const remaining = removeQueuedFollowup(markFollowupSteered(items, "second", 100), "second")
    expect(remaining.map((item) => item.id)).toEqual(["first", "third"])
    expect(nextQueuedFollowup(remaining)?.id).toBe("first")
  })
})
