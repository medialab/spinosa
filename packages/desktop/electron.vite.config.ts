import { defineConfig } from "electron-vite"
import appPlugin from "@spinosa/app/vite"
import * as fs from "node:fs/promises"

const SPINOSA_SERVER_DIST = "../spinosa-kernel/dist/node"

const channel = (() => {
  const raw = process.env.SPINOSA_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.SPINOSA_CHANNEL === "latest") return "prod"
  return "dev"
})()

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

const sentry = await (async () => {
  if (!process.env.SENTRY_AUTH_TOKEN || !process.env.SENTRY_ORG || !process.env.SENTRY_PROJECT) {
    return false
  }

  const { sentryVitePlugin } = await import("@sentry/vite-plugin")
  return sentryVitePlugin({
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    telemetry: false,
    release: {
      name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
    },
    sourcemaps: {
      assets: "./out/renderer/**",
      filesToDeleteAfterUpload: "./out/renderer/**/*.map",
    },
  })
})()

export default defineConfig({
  main: {
    define: {
      "import.meta.env.SPINOSA_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts" },
        // Keep this identical to electron-vite's Node 20.11+ shim. Its regex insertion can
        // corrupt bundled TypeScript, while a Rollup banner places the shim safely.
        output: {
          banner: `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`,
        },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "opencode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "spinosa:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:spinosa-server") return this.resolve(`${SPINOSA_SERVER_DIST}/server-entry.js`)
        },
      },
      {
        name: "spinosa:copy-server-assets",
        async writeBundle() {
          for (const l of await fs.readdir(SPINOSA_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${SPINOSA_SERVER_DIST}/${l}`))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
