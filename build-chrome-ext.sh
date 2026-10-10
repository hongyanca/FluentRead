#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STABLE_EXTENSION_DIR="${FLUENTREAD_CHROME_EXTENSION_DIR:-${HOME}/.fr-chrome-ext}"

cd "$PROJECT_DIR"
pnpm install
pnpm run build

mkdir -p "$STABLE_EXTENSION_DIR"
cp -R .output/chrome-mv3/. "$STABLE_EXTENSION_DIR/"

printf '\nChrome extension build is ready at:\n%s\n' "$STABLE_EXTENSION_DIR"
printf 'In Chrome, choose chrome://extensions → Load unpacked and select this folder.\n'
