# Lima Linux binary soak (practical)

Native smoke for `spinosa-linux-*` after a four-target local build.
Complements — does **not** replace — [stable-promotion-gates.md](stable-promotion-gates.md), [beta-10-cut-checklist.md](beta-10-cut-checklist.md), [binary-distribution-contract.md](binary-distribution-contract.md).

Full interactive / TEST-VAULT gates: `workspace-template/docs/reference/testsuite.md` Phase F.

## Targets

| Asset | Soak host |
| ----- | --------- |
| `spinosa-linux-arm64` | Lima Ubuntu **aarch64** (native on Apple Silicon) |
| `spinosa-linux-x64` | Lima Ubuntu **x86_64** (emulated on Apple Silicon — slow) |
| Darwin assets | Host / Rosetta — out of scope here |

Unsupported by contract: musl/Alpine (optional negative check below).

## Prerequisites

```bash
# Host (darwin-arm64 typical)
brew install lima   # if missing; limactl ≥ 1.0
limactl --version
```

## 1. Build four product binaries (host)

No `--host-only`. From repo root:

```bash
VERSION="$(jq -r .version package.json)"
CHANNEL=beta   # or stable
DIST="dist/v${VERSION}"

SPINOSA_BINARY_SMOKE_STRICT=1 bun run build:binaries \
  -- --out-dir "$DIST" --version "$VERSION" --channel "$CHANNEL"
```

Then stage installer + checksums (release pipeline does this; soak helper can too):

```bash
bash script/lima-linux-soak.sh --dist "$DIST" --stage-only
```

Expect under `$DIST`: `install.sh`, four `spinosa-*`, `checksums.txt`, `build-manifest.json`.

Host-side structure / HTTP smoke (darwin binary only deep-runs):

```bash
bun script/smoke-install.ts --dist "$DIST"
# structure-only if host binary absent from a Linux-only tree:
SPINOSA_SMOKE_STRUCTURE=1 bun script/smoke-install.ts --dist "$DIST"
```

## 2. Lima VMs

Default Ubuntu template mounts `~` (repo visible at the same macOS path inside the guest).

```bash
# Native arm64 Ubuntu (reuse if already present)
limactl start --name spinosa-linux-arm64 template://ubuntu
# or: limactl start spinosa-test   # if you already have one

# Cross-arch x64 (Apple Silicon → qemu; first boot + compile soak are slow)
limactl start --name spinosa-linux-x64 --arch x86_64 template://ubuntu
```

Useful:

```bash
limactl list
limactl shell spinosa-linux-arm64
limactl stop spinosa-linux-arm64
```

## 3. Copy / serve assets + virgin install smoke

Preferred: run the helper (copies into guest `/tmp` so install is not tied to a live mount):

```bash
# arm64 guest (matches host Apple Silicon)
bash script/lima-linux-soak.sh --dist "$DIST" --instance spinosa-linux-arm64 --smoke

# x64 guest
bash script/lima-linux-soak.sh --dist "$DIST" --instance spinosa-linux-x64 --smoke
```

Manual equivalent inside the guest:

```bash
# from host
INSTANCE=spinosa-linux-arm64
limactl copy "$DIST/spinosa-linux-arm64" "$DIST/install.sh" "$DIST/checksums.txt" \
  "$DIST/build-manifest.json" "${INSTANCE}:/tmp/spinosa-dist/"
# also copy the matching binary name only; guest detects arch via uname

limactl shell "$INSTANCE" -- bash -lc '
  set -euo pipefail
  cd /tmp/spinosa-dist
  python3 -m http.server 8765 >/tmp/spinosa-http.log 2>&1 &
  echo $! >/tmp/spinosa-http.pid
  export HOME=/tmp/spinosa-virgin-user
  export SPINOSA_HOME="$HOME/.spinosa"
  export SPINOSA_BIN_DIR="$HOME/.local/bin"
  export SPINOSA_RELEASE_BASE_URL=http://127.0.0.1:8765
  rm -rf "$HOME"
  mkdir -p "$HOME" "$SPINOSA_BIN_DIR"
  bash ./install.sh --yes --no-launch
  "$SPINOSA_HOME/bin/spinosa" version
  "$SPINOSA_HOME/bin/spinosa" doctor
  kill "$(cat /tmp/spinosa-http.pid)" || true
'
```

Pass criteria: install exit 0; `version` shows the cut; `doctor` healthy with **Distribution: binary**; PDF / Canvas / MarkItDown available. On **linux-x64**, OCR must report **unsupported** (not a crash and not a fail-closed activation block). On **linux-arm64**, OCR may be available or missing — fail only if doctor exits non-zero for non-OCR reasons.

Optional tiny corpus (if doctor green):

```bash
# inside guest, same SPINOSA_HOME
mkdir -p /tmp/spinosa-tiny-corpus
printf '%%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%%%EOF\n' > /tmp/spinosa-tiny-corpus/tiny.pdf
"$SPINOSA_HOME/bin/spinosa" new /tmp/spinosa-tiny-corpus \
  --extensions pdf --cli other --launch copy --no-color || true
```

Deeper TEST-VAULT: Phase F in `workspace-template/docs/reference/testsuite.md`.

## 4. Optional musl / Alpine negative check

Contract: musl unsupported. `install.sh` currently maps Alpine as `linux-*` and will attempt a glibc asset.

```bash
limactl start --name spinosa-alpine --arch aarch64 template://alpine
# copy linux-arm64 + install.sh + checksums the same way, then:
# Expect: loader / activation / doctor failure — not a successful binary install.
# If a future cut adds an explicit musl refuse message, prefer that.
```

## Caveats

- **Cross-arch Lima** (`--arch x86_64` on arm64 Mac): qemu, slower, more RAM; prefer native aarch64 for day-to-day Linux soak; still run x64 before stable. Installer staged-binary verify defaults to **400s** (override with `SPINOSA_VERIFY_TIMEOUT_SECONDS`) for canvas/native cold-boot cost on qemu.
- **Nested virt**: not required for this soak; only if you nest another hypervisor/container runtime inside Lima.
- **Mount vs copy**: home mount is convenient for reading `dist/`, but virgin smoke should use a fresh `SPINOSA_HOME` under `/tmp` (helper does this).
- **Host-only builds** (`build:binaries:host`) cannot soak Linux — rebuild without `--host-only`.
- Do not promote stable until Linux glibc rows in [stable-promotion-gates.md](stable-promotion-gates.md) are checked.
