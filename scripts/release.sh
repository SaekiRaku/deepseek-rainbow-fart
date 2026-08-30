#!/usr/bin/env bash
# Cross-platform release build: builds the plugin ONCE, downloads each
# platform's sherpa-onnx native addon from npm, and produces one self-contained
# ZIP per platform. No per-platform build environment is required — the native
# addons are prebuilt npm packages.
#
# Usage:
#   bash scripts/release.sh                    # all platforms
#   PLATFORMS="darwin-arm64 win-x64" bash scripts/release.sh
#   SHERPA_VERSION=1.13.5 bash scripts/release.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SHERPA_VERSION="${SHERPA_VERSION:-1.13.5}"
PLATFORMS="${PLATFORMS:-darwin-arm64 darwin-x64 linux-x64 linux-arm64 win-x64}"

# ── 1. build the plugin once ─────────────────────────────────────────────────
echo "▶ Building plugin (node + browser halves)..."
(cd "$REPO/packages/core" && node scripts/build.mjs)
node "$REPO/scripts/assemble-bundle.mjs" "$REPO/.dsh-bundle"

# ── 2. locate the platform-independent sherpa JS wrapper ─────────────────────
# Bun workspaces installs workspace deps in the workspace's own node_modules,
#  so look in both the root and packages/core locations.
SNODE_SRC="$(ls -d "$REPO"/node_modules/sherpa-onnx-node "$REPO"/packages/core/node_modules/sherpa-onnx-node 2>/dev/null | head -1 || true)"
[ -n "$SNODE_SRC" ] || {
	echo "sherpa-onnx-node not found — run 'bun install' first" >&2
	exit 1
}

# ── 3. prepare the shared native wrapper payload ────────────────────────────
DIST="$REPO/dist"
rm -rf "$DIST"
mkdir -p "$DIST"
SHARED="$(mktemp -d)/shared"
mkdir -p "$SHARED/node_modules"
cp -RL "$SNODE_SRC" "$SHARED/node_modules/sherpa-onnx-node"

# ── 4. per platform: download the native addon, assemble, zip ────────────────
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$(dirname "$SHARED")"' EXIT

for TAG in $PLATFORMS; do
	PNAME="sherpa-onnx-${TAG}"
	echo "▶ Packaging $TAG ..."

	W="$WORK/$TAG"
	mkdir -p "$W"
	if ! (cd "$W" && npm pack "$PNAME@$SHERPA_VERSION" --silent >/dev/null 2>&1); then
		echo "  ✗ failed to download $PNAME — skipping"
		continue
	fi
	TGZ="$(ls "$W"/sherpa-onnx-*.tgz 2>/dev/null | head -1 || true)"
	[ -n "$TGZ" ] || {
		echo "  ✗ no tarball for $PNAME — skipping"
		continue
	}

	rm -rf "$W/extract"
	mkdir -p "$W/extract"
	tar xzf "$TGZ" -C "$W/extract"
	ADDON_DIR="$(find "$W/extract" -type d -name package | head -1 || true)"
	[ -n "$ADDON_DIR" ] || {
		echo "  ✗ addon not found in $PNAME — skipping"
		continue
	}

	PKG="$DIST/deepseek-rainbow-fart-$TAG"
	rm -rf "$PKG"
	mkdir -p "$PKG/bundle"
	cp -R "$REPO/.dsh-bundle/." "$PKG/bundle"
	rm -rf "$PKG/bundle/node_modules"
	cp -R "$SHARED/node_modules" "$PKG/bundle/node_modules"
	cp -R "$ADDON_DIR" "$PKG/bundle/node_modules/$PNAME"
	cp "$REPO/scripts/install.js" "$PKG/install.js"
	cp "$REPO/scripts/release-README.md" "$PKG/README.md"

	(cd "$DIST" && rm -f "deepseek-rainbow-fart-$TAG.zip" && zip -rq "deepseek-rainbow-fart-$TAG.zip" "deepseek-rainbow-fart-$TAG")
	echo "  ✅ $DIST/deepseek-rainbow-fart-$TAG.zip"
done

echo "Release complete. See: $DIST"
