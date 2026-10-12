#!/usr/bin/env bash
set -euo pipefail

# 1. Version check: retry up to 3 times with 20s sleeps
VERSION_PASSED=false
VERSION_STATUS=""

for attempt in 1 2 3; do
  RES=$(curl -s -w "\n%{http_code}" https://www.yourbody.fyi/version.json || true)
  CODE=$(echo "$RES" | tail -n 1)
  BODY=$(echo "$RES" | sed '$d')
  VERSION_STATUS="$CODE"

  if [ "$CODE" = "200" ]; then
    SHA=$(echo "$BODY" | jq -r '.sha // empty' 2>/dev/null || true)
    if [[ "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
      VERSION_PASSED=true
      break
    fi
  fi

  if [ "$attempt" -lt 3 ]; then
    sleep 20
  fi
done

echo "version.json: ${VERSION_STATUS:-failed}"

# 2. Billing smoke check
HTML=$(curl -sL https://www.yourbody.fyi/ || true)
ORIGIN=$(echo "$HTML" | grep -oE "https://[a-z0-9]+\.supabase\.co" | head -n 1 || true)

if [ -n "$ORIGIN" ]; then
  # Mask origin and project ref in CI logs
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::add-mask::$ORIGIN"
    REF=$(echo "$ORIGIN" | sed -E 's|https://([a-z0-9]+)\.supabase\.co.*|\1|')
    if [ -n "$REF" ]; then
      echo "::add-mask::$REF"
    fi
  fi

  # stripe-webhook check
  WEBHOOK_RES=$(curl -s -w "\n%{http_code}" -X POST "$ORIGIN/functions/v1/stripe-webhook" \
    -H "Origin: https://www.yourbody.fyi" \
    -H "Content-Type: application/json" \
    -d "{}" || true)
  STATUS_WEBHOOK=$(echo "$WEBHOOK_RES" | tail -n 1)
  BODY_WEBHOOK=$(echo "$WEBHOOK_RES" | sed '$d')

  WEBHOOK_PASSED=false
  if [ "$STATUS_WEBHOOK" = "400" ] && echo "$BODY_WEBHOOK" | grep -qi "Invalid signature"; then
    WEBHOOK_PASSED=true
  fi
  echo "stripe-webhook: ${STATUS_WEBHOOK:-failed}"

  # create-checkout check
  CHECKOUT_RES=$(curl -s -w "\n%{http_code}" -X POST "$ORIGIN/functions/v1/create-checkout" \
    -H "Origin: https://www.yourbody.fyi" \
    -H "Content-Type: application/json" \
    -d "{}" || true)
  STATUS_CHECKOUT=$(echo "$CHECKOUT_RES" | tail -n 1)

  CHECKOUT_PASSED=false
  if [ "$STATUS_CHECKOUT" = "401" ]; then
    CHECKOUT_PASSED=true
  fi
  echo "create-checkout: ${STATUS_CHECKOUT:-failed}"

  # create-portal-session check
  PORTAL_RES=$(curl -s -w "\n%{http_code}" -X POST "$ORIGIN/functions/v1/create-portal-session" \
    -H "Origin: https://www.yourbody.fyi" \
    -H "Content-Type: application/json" \
    -d "{}" || true)
  STATUS_PORTAL=$(echo "$PORTAL_RES" | tail -n 1)

  PORTAL_PASSED=false
  if [ "$STATUS_PORTAL" = "401" ]; then
    PORTAL_PASSED=true
  fi
  echo "create-portal-session: ${STATUS_PORTAL:-failed}"
else
  WEBHOOK_PASSED=false
  CHECKOUT_PASSED=false
  PORTAL_PASSED=false
  echo "stripe-webhook: failed (origin not found)"
  echo "create-checkout: failed (origin not found)"
  echo "create-portal-session: failed (origin not found)"
fi

# Determine overall pass/fail
ALL_PASSED=true
FAILURES=""

if [ "$VERSION_PASSED" != "true" ]; then
  ALL_PASSED=false
  FAILURES="${FAILURES}- version.json (status: ${VERSION_STATUS:-failed})\n"
fi

if [ -z "$ORIGIN" ]; then
  ALL_PASSED=false
  FAILURES="${FAILURES}- supabase origin discovery (not found in live HTML)\n"
fi

if [ "$WEBHOOK_PASSED" != "true" ]; then
  ALL_PASSED=false
  FAILURES="${FAILURES}- stripe-webhook (status: ${STATUS_WEBHOOK:-failed})\n"
fi

if [ "$CHECKOUT_PASSED" != "true" ]; then
  ALL_PASSED=false
  FAILURES="${FAILURES}- create-checkout (status: ${STATUS_CHECKOUT:-failed})\n"
fi

if [ "$PORTAL_PASSED" != "true" ]; then
  ALL_PASSED=false
  FAILURES="${FAILURES}- create-portal-session (status: ${STATUS_PORTAL:-failed})\n"
fi

# 3. Issue alerting on GitHub Actions
if [ -n "${GITHUB_ACTIONS:-}" ] && [ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]; then
  OPEN_ISSUE=$(gh issue list --state open --search "\"Uptime check failed\" in:title" --json number,title --jq '.[] | select(.title == "Uptime check failed") | .number' 2>/dev/null | head -n 1 || true)

  if [ "$ALL_PASSED" = "true" ]; then
    if [ -n "$OPEN_ISSUE" ]; then
      RECOVERY_TIME=$(date -u +"%Y-%m-%d %H:%M:%SZ")
      gh issue comment "$OPEN_ISSUE" --body "Recovered at $RECOVERY_TIME" || true
      gh issue close "$OPEN_ISSUE" || true
    fi
  else
    if [ -z "$OPEN_ISSUE" ]; then
      RUN_LINK="${RUN_URL:-${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-lilo123/yourbody-fyi}/actions/runs/${GITHUB_RUN_ID:-unknown}}"
      ISSUE_BODY=$(cat <<EOF
### Uptime check failed

The scheduled uptime check detected the following failure(s):

$(echo -e "$FAILURES")

**Run URL:** ${RUN_LINK}
EOF
)
      gh issue create --title "Uptime check failed" --body "$ISSUE_BODY" || true
    fi
  fi
fi

if [ "$ALL_PASSED" = "true" ]; then
  exit 0
else
  exit 1
fi
