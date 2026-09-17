import path from "path"
import os from "os"
import fs from "fs"
import { afterAll } from "bun:test"

const testHome = path.join(os.tmpdir(), `spinosa-core-test-home-${process.pid}`)
fs.mkdirSync(testHome, { recursive: true })
process.env.SPINOSA_TEST_HOME = testHome
process.env.SPINOSA_HOME = path.join(testHome, ".spinosa")

afterAll(() => {
  try {
    fs.rmSync(testHome, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors on exit
  }
})

process.env.SPINOSA_DB = ":memory:"
process.env.SPINOSA_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.SPINOSA_DISABLE_MODELS_FETCH = "true"
