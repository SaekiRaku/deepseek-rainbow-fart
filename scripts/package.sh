#!/usr/bin/env bash
# Current-platform quick build: delegates to release.sh for just this platform.
# For cross-platform release, run: bash scripts/release.sh (or `bun run release`).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

case "$(uname -s)" in
	Darwin) P=darwin ;;
	Linux) P=linux ;;
	MINGW* | MSYS* | CYGWIN*) P=win ;;
	*) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
	x86_64 | amd64) A=x64 ;;
	arm64 | aarch64) A=arm64 ;;
	*) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

PLATFORMS="$P-$A" bash "$REPO/scripts/release.sh"
