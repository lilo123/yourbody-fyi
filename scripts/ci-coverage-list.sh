#!/bin/bash
set -euo pipefail

CI_FILE="${1:-.github/workflows/ci.yml}"

if [ ! -f "$CI_FILE" ]; then
  echo "Error: CI workflow file not found: $CI_FILE" >&2
  exit 1
fi

echo "================================================================================"
echo "CI Coverage & Job Command Inventory: $CI_FILE"
echo "================================================================================"

awk '
/^jobs:/ { in_jobs=1; next }
in_jobs && /^  [a-zA-Z0-9_-]+:/ {
  job=$1; sub(/:$/, "", job)
  print "\nJob: " job
  next
}
in_jobs && /^[a-zA-Z0-9_-]+:/ { in_jobs=0 }
in_jobs && /name:/ {
  line=$0; sub(/^.*name: */, "", line)
  step=line
}
in_jobs && /run:/ {
  line=$0; sub(/^.*run: */, "", line)
  if (line == "|") {
    print "  Step: " step
    print "    run: | (multi-line script)"
  } else {
    print "  Step: " step
    print "    run: " line
  }
}
' "$CI_FILE"

echo ""
echo "================================================================================"
echo "Test Suite Inventory & File Counts"
echo "================================================================================"
VITEST_COUNT=$(find src -name "*.test.ts*" 2>/dev/null | wc -l)
PGTAP_COUNT=$(ls -1 supabase/tests/*.test.sql 2>/dev/null | wc -l)
DENO_COUNT=$(ls -1 supabase/functions/*/index.test.ts 2>/dev/null | wc -l)

echo "Vitest test files:          $VITEST_COUNT"
echo "pgTAP test files:           $PGTAP_COUNT"
echo "Deno test files:            $DENO_COUNT"

echo ""
echo "Playwright Project Counts:"
for proj in "Desktop Chrome" "Mobile Safari" "Narrow Safari (320px)"; do
  COUNT_LINE=$(npx playwright test tests/e2e --list --project="$proj" 2>&1 | grep "Total:" || echo "Failed to count")
  echo "  - tests/e2e [$proj]: $COUNT_LINE"
done

DENSITY_LINE=$(npx playwright test -c playwright.density.config.ts --list 2>&1 | grep "Total:" || echo "Failed to count")
echo "  - Density (chromium):              $DENSITY_LINE"

PWA_LINE=$(npx playwright test -c playwright.pwa.config.ts --list 2>&1 | grep "Total:" || echo "Failed to count")
echo "  - PWA production (Desktop Chrome): $PWA_LINE"

echo "================================================================================"
