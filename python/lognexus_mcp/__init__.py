"""Cross-platform Python/uvx launcher for @digital-lake/lognexus."""

from __future__ import annotations

import shutil
import subprocess
import sys

__version__ = "1.3.5"
NPM_PACKAGE = f"@digital-lake/lognexus@{__version__}"


def _resolve_npx() -> str:
    for candidate in ("npx", "npx.cmd"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    sys.stderr.write(
        "Error: LogNexus requires Node.js >= 20 (npx was not found in PATH).\n"
        "Install Node.js from https://nodejs.org and try again.\n"
    )
    raise SystemExit(1)


def run_lognexus(args: list[str]) -> int:
    npx_bin = _resolve_npx()
    cmd = [npx_bin, "--yes", NPM_PACKAGE, *args]
    completed = subprocess.run(cmd, shell=False, check=False)
    return int(completed.returncode)


def main_cli() -> None:
    raise SystemExit(run_lognexus(sys.argv[1:]))


def main_mcp() -> None:
    args = sys.argv[1:] if len(sys.argv) > 1 else ["mcp"]
    raise SystemExit(run_lognexus(args))
