#!/usr/bin/env bash
# Install the built deepseek-rainbow-fart bundle into a dsh profile using the
# Node installer. Run from repo root:
#   bash scripts/install-to-profile.sh <profileDir>
#   e.g. bash scripts/install-to-profile.sh ~/.dsh/profiles/web
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${1:?usage: install-to-profile.sh <profileDir>}"
BUNDLE="$REPO/.dsh-bundle"

echo "Installing deepseek-rainbow-fart into: $PROFILE"

node "$REPO/scripts/assemble-bundle.mjs" "$BUNDLE"

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DSH_HOME="$DSH_HOME" DSH_BUNDLE="$BUNDLE" node "$REPO/scripts/install.js" "$PROFILE"

echo "Done. Restart with: dsh --profile $(basename "$PROFILE")"
