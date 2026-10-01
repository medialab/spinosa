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

## Diagnostics and credentials

Debug ZIPs include sanitized text logs only; crash dumps and network traces are
excluded. Raw network tracing is off by default. Set `SPINOSA_DESKTOP_NETLOG=1`
only for a local investigation, and do not share the resulting trace without
reviewing it. Desktop settings and Spinosa's credential data are kept in
owner-only local files after the updated app next opens them.
