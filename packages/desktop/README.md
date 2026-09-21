# Spinosa Desktop

The Spinosa Desktop app, built with Electron. It embeds the Spinosa kernel
server as a sidecar (`virtual:spinosa-server`, built by
`scripts/build-server.ts`) and hosts the Spinosa web UI (`packages/app`).

## Development

```bash
bun install
bun dev
```

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
bun run build && bun run package
```
