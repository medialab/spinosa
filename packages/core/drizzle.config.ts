import { defineConfig } from "drizzle-kit"
import path from "node:path"
import { resolveUserDir } from "./src/util/user-dirs"

const databasePath = process.env.SPINOSA_DB_PATH || path.join(resolveUserDir("data"), "spinosa.db")

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"],
  out: "./migration",
  dbCredentials: {
    url: databasePath,
  },
})
