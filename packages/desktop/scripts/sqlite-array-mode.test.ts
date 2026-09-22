import { describe, expect, test } from "bun:test"
import { patchStatement } from "./sqlite-array-mode"

type FakeStatement = {
  all: (...args: Array<unknown>) => unknown
  get: (...args: Array<unknown>) => unknown
  iterate: (...args: Array<unknown>) => unknown
  setReturnArrays?: (enabled: boolean) => unknown
}

const rows = () => [
  { id: 1, name: "a" },
  { id: 2, name: "b" },
]

function fake(): FakeStatement {
  return {
    all: () => rows(),
    get: () => rows()[0],
    iterate: function* () {
      yield* rows()
    },
  }
}

describe("sqlite array-mode patchStatement", () => {
  test("passes statements with native setReturnArrays through untouched", () => {
    const statement = { ...fake(), setReturnArrays: () => undefined }
    expect(patchStatement(statement)).toBe(statement)
  })

  test("object mode is the default (kernel object queries unaffected)", () => {
    const statement = patchStatement(fake())
    expect(statement.all()).toEqual(rows())
    expect(statement.get()).toEqual(rows()[0])
    expect([...(statement.iterate() as Iterable<unknown>)]).toEqual(rows())
  })

  test("setReturnArrays(true) maps rows to arrays (kernel value queries)", () => {
    const statement = patchStatement(fake())
    ;(statement as FakeStatement).setReturnArrays?.(true)
    expect(statement.all()).toEqual([
      [1, "a"],
      [2, "b"],
    ])
    expect(statement.get()).toEqual([1, "a"])
    expect([...(statement.iterate() as Iterable<unknown>)]).toEqual([
      [1, "a"],
      [2, "b"],
    ])
  })

  test("setReturnArrays(false) restores object mode", () => {
    const statement = patchStatement(fake())
    ;(statement as FakeStatement).setReturnArrays?.(true)
    ;(statement as FakeStatement).setReturnArrays?.(false)
    expect(statement.all()).toEqual(rows())
  })

  test("null and scalar rows pass through in array mode", () => {
    const statement = patchStatement({ ...fake(), get: () => null, all: () => [] })
    ;(statement as FakeStatement).setReturnArrays?.(true)
    expect(statement.get()).toBeNull()
    expect(statement.all()).toEqual([])
  })
})
