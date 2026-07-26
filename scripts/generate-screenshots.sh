#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
MUSTER_DEMO_MODE=true NEXT_PUBLIC_MUSTER_DEMO_MODE=true \
  pnpm exec playwright test tests/screenshots.spec.ts --project=chromium
