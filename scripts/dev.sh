#!/usr/bin/env bash
# Dev stage: build the plugin and auto-apply it into a dsh profile, then boot
# the dsh Web UI so local changes take effect on the next run.
#
# Usage:
#   bash scripts/dev.sh                  # use ~/.dsh/profiles/web
#   bash scripts/dev.sh <profileDir>     # apply into an explicit profile
#
# The built bundle is installed through dsh's official plugin manager so the
# profile manifest and bundle ordering remain valid across dsh updates.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${1:-$HOME/.dsh/profiles/web}"

echo "▶ Building core (node + client)..."
(cd "$REPO" && bun run build:core)

echo "▶ Applying dev build into $PROFILE ..."
bash "$REPO/scripts/install-to-profile.sh" "$PROFILE"

echo "▶ Starting dsh web (bunx @deepseek-ai/dsh web)..."
echo "  → open http://127.0.0.1:3080"
exec bunx @deepseek-ai/dsh web
