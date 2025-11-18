#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
RELEASE_DIR="$ROOT_DIR/release"

build_variant() {
  local variant="$1"
  local include_cloud="$2"
  local bundle_models="$3"

  echo "🚧 Building ${variant} variant (INCLUDE_CLOUD=${include_cloud}, BUNDLE_MODELS=${bundle_models})"
  rm -rf "$DIST_DIR"

  (cd "$ROOT_DIR" && INCLUDE_CLOUD="${include_cloud}" BUNDLE_MODELS="${bundle_models}" pnpm run build)

  local variant_dist="${ROOT_DIR}/dist-${variant}"
  rm -rf "$variant_dist"
  mv "$DIST_DIR" "$variant_dist"

  echo "✅ Build output stored in dist-${variant}/"
}

mkdir -p "$RELEASE_DIR"

build_variant "local" "false" "true"
build_variant "balanced" "true" "false"
build_variant "full" "true" "true"

echo "🎉 Variant builds complete."


