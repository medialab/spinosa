import { defineConfig } from "drizzle-kit"
import os from "node:os"
import path from "node:path"

const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const databasePath = process.env.SPINOSA_DB_PATH || path.join(dataHome, "spinosa", "spinosa.db")

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"],
  out: "./migration",
  dbCredentials: {
    url: databasePath,
  },
})
