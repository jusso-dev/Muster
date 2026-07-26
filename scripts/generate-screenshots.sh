#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm exec playwright test tests/screenshots.spec.ts --project=chromium
