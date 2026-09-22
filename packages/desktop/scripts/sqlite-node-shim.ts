/**
 * Plain-Node interop shim for `node:sqlite`, aliased by the sidecar bundle
 * build (`build-server.ts`).
 *
 * The kernel's Node SQLite driver (`@spinosa/kernel-core`, `#sqlite` →
 * `database/sqlite.node.ts`) calls `statement.setReturnArrays(true)` for
 * value-mode queries. That method exists on `bun:sqlite` statements but not
 * on `node:sqlite` `StatementSync` (verified absent on Node v22.14.0), so
 * every workspace-routed request dies in `Project.fromDirectory` with
 * `TypeError: statement2.setReturnArrays is not a function` and surfaces as
 * an `UnknownError` 500. Bun never hits this: its `#sqlite` conditional
 * selects the bun driver instead.
 *
 * This module re-exports the real builtin by name (explicit named
 * re-exports: `export *` from an external breaks Bun's ESM output) except
 * for supplying the missing array mode via `patchStatement`
 * (`sqlite-array-mode.ts`). If a future Node ships native
 * `setReturnArrays`, statements pass through untouched. The kernel file is
 * read-only for desktop work, so the shim lives here; upstream fix: guard
 * the `setReturnArrays` call in `packages/core/src/database/sqlite.node.ts`.
 */
import { DatabaseSync as NodeDatabaseSync, StatementSync as NodeStatementSync, constants } from "node:sqlite"
import type { StatementSync as NodeStatementSyncType } from "node:sqlite"
import { patchStatement } from "./sqlite-array-mode"

const Base = NodeDatabaseSync as unknown as new (...args: Array<never>) => {
  prepare: (sql: string) => NodeStatementSyncType
}

class DatabaseSyncCompat extends Base {
  override prepare(sql: string): NodeStatementSyncType {
    return patchStatement(super.prepare(sql))
  }
}
Object.defineProperty(DatabaseSyncCompat, "name", { value: "DatabaseSync" })

export { DatabaseSyncCompat as DatabaseSync, NodeStatementSync as StatementSync, constants }
