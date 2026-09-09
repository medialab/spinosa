#!/usr/bin/env python3
"""Bounded audit probes; no network or real installation. See companion audit.

Run with Python 3 from any directory. Bun is optional (for the smoke probe).
These characterize defects, so OBSERVED is an audit result, not a passing test.
"""

import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[3]


def probe_input_flush() -> None:
    with tempfile.TemporaryDirectory(prefix="spinosa-audit-input-") as directory:
        env = {
            **os.environ,
            "HOME": directory,
            "SPINOSA_HOME": directory + "/.spinosa",
            "SPINOSA_INSTALLER_LIB_ONLY": "1",
            "SPINOSA_LOG_DISABLED": "1",
        }
        for label, data in [("pipe with input", b"yes\n"), ("pipe at EOF", b"")]:
            try:
                result = subprocess.run(
                    ["bash", "-c", 'installer="$1"; set --; source "$installer"; flush_pending_input; echo RETURNED',
                     "audit", str(ROOT / "install.sh")],
                    input=data, capture_output=True, env=env, timeout=2,
                    start_new_session=True,
                )
                print(f"flush {label}: exited {result.returncode}; {result.stdout.decode().strip()}")
                if result.stderr:
                    print(result.stderr.decode().strip())
            except subprocess.TimeoutExpired:
                print(f"OBSERVED: flush {label} did not return within 2s")


def probe_pipeline_status() -> None:
    # Simulate curl failing before producing a script, without using the network.
    result = subprocess.run(
        ["bash", "-c", "(exit 22) | bash"],
        capture_output=True, text=True, timeout=2,
    )
    print(f"bootstrap pipeline: producer failed 22, pipeline exited {result.returncode}")


def probe_smoke_false_success() -> None:
    bun = shutil.which("bun")
    if not bun:
        print("SKIP smoke probe: Bun unavailable")
        return
    os_name = {"Darwin": "darwin", "Linux": "linux"}.get(platform.system())
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "AMD64": "x64"}.get(platform.machine())
    if not os_name or not arch:
        print("SKIP smoke probe: unsupported host")
        return
    with tempfile.TemporaryDirectory(prefix="spinosa-audit-smoke-") as directory:
        fixture = Path(directory)
        dist = fixture / "dist"
        dist.mkdir()
        (dist / "install.sh").write_text("#!/bin/bash\necho AUDIT_INSTALLER_FAILED >&2\nexit 17\n")
        (dist / "checksums.txt").write_text("")
        (dist / f"spinosa-{os_name}-{arch}").write_text("#!/bin/sh\necho AUDIT_FAKE_BINARY_OK\nexit 0\n")
        result = subprocess.run(
            [bun, "script/smoke-install.ts", "--dist", str(dist)],
            cwd=ROOT, capture_output=True, text=True, timeout=15,
            env={**os.environ, "SPINOSA_BIN_DIR": str(fixture / "bin"),
                 "SPINOSA_SMOKE_STRUCTURE": "0"},
        )
        print(f"smoke: mocked installer exits 17; smoke exits {result.returncode}")
        print(result.stdout.strip())
        print(result.stderr.strip())


if __name__ == "__main__":
    print(f"host: {platform.system()} {platform.machine()}")
    probe_input_flush()
    probe_pipeline_status()
    probe_smoke_false_success()
