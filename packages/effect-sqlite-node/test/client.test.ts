import { describe, expect, test, mock } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// Provide a minimal node:sqlite mock before importing the module so that
// bun's coverage can instrument src/index.ts even on Bun without node:sqlite.
mock.module("node:sqlite", () => {
  class FakeDatabaseSync {
    static lastOpts: unknown = null
    static lastExec: string | null = null
    constructor(_filename: string, opts: unknown) {
      ;(FakeDatabaseSync as unknown as Record<string, unknown>).lastOpts = opts
    }
    exec(sql: string) {
      FakeDatabaseSync.lastExec = sql
      return [] as unknown as never
    }
    prepare() {
      return {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        all: (..._args: unknown[]) => [] as unknown[],
        setReadBigInts: () => {},
        setReturnArrays: () => {},
      } as unknown as never
    }
    loadExtension() {}
    close() {}
  }
  return { DatabaseSync: FakeDatabaseSync }
})

// Gap G2: package had zero tests — status=no-tests, branches unmeasured.
// Previously dispositioned as "test gap" (not a bug) in the quality remediation
// (packages/effect-sqlite-node: 1 source, 0 tests, missing=1). Systematic
// bugfinder requires treating untested critical primitives as bugs: the
// File: packages/effect-sqlite-node/src/index.ts contains the only
// NodeSqliteClient implementation and had two confirmed defects left as
// "not tested": H14 (executeUnprepared delegated to prepare) and M26
// (create/readwrite ignored). Both were fixed but had no regression
// coverage, so "no-tests" masked a potential regression.
// This suite closes the gap as a bug: it asserts the fixes remain present
// and exercises the runtime path via the mocked DatabaseSync so that
// coverage instruments the source.
describe("effect-sqlite-node — coverage gap left as not tested", () => {
  const source = readFileSync(path.join(import.meta.dir, "../src/index.ts"), "utf8")

  test("M26: create/readwrite options are propagated to DatabaseSync (not ignored)", () => {
    expect(source).toContain("create: options.create")
    expect(source).toContain("readwrite: options.readwrite")
    expect(source).toMatch(/new DatabaseSync\(options\.filename,\s*\{[^}]*create:[^}]*readwrite:/s)
  })

  test("H14: executeUnprepared uses db.exec, not db.prepare (defeats preparation)", () => {
    expect(source).toContain("executeUnprepared")
    expect(source).toContain("db.exec(sql)")
    expect(source).not.toMatch(/executeUnprepared[\s\S]*?this\.execute\(\)/)
    expect(source).toContain("Effect.try")
    expect(source).toContain("classifySqliteError")
  })

  test("no self-referencing circular export (C5)", () => {
    expect(source).not.toContain('export * as NodeSqliteClient from "./index"')
    expect(source).not.toContain("export * as NodeSqliteClient")
  })

  test("package still exports TypeId and SqliteClient with config passthrough", async () => {
    expect(source).toContain("export const TypeId")
    expect(source).toContain("export const SqliteClient = Context.Service")
    expect(source).toContain("readonly config: SqliteClientConfig")
    expect(source).toContain("config: options")

    // Exercise the runtime path so that lcov instruments src/index.ts:
    const { SqliteClient, layer } = await import("../src/index")
    const Effect = await import("effect/Effect")
    const client = await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* SqliteClient
        return c
      }).pipe(Effect.provide(layer({ filename: ":memory:", create: true, readwrite: true, disableWAL: true })), Effect.scoped),
    )
    expect((client as unknown as { config: { create: boolean } }).config.create).toBe(true)
    // Verify the mocked DatabaseSync received the options
    const { DatabaseSync } = await import("node:sqlite")
    expect((DatabaseSync as unknown as { lastOpts: Record<string, unknown> }).lastOpts).toMatchObject({
      create: true,
      readwrite: true,
    })
  })
})
