#!/usr/bin/env bash
# =============================================================================
# SQL <-> TypeScript portion-converter parity check.
# -----------------------------------------------------------------------------
# supabase/tests/fixtures/portion_corpus.json is the single source of truth.
# src/utils/unitConverter.test.ts asserts the TypeScript converter against it;
# this script asserts private.portion_to_canonical() against the same table.
# If both pass, the two converters agree.
#
# Usage: scripts/check-portion-parity.sh [database]   (default: scratch_hier)
# =============================================================================
set -euo pipefail

CONTAINER=supabase_db_fitness-tracking
DB=${1:-scratch_hier}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

python3 - <<'PY' > /tmp/portion_parity.sql
import json
rows = json.load(open('supabase/tests/fixtures/portion_corpus.json'))
vals = [
    "('%s', %s::numeric, '%s', '%s')"
    % (r['portion'].replace("'", "''"), r['quantity'], r['unit'], r['confidence'])
    for r in rows
]
print("WITH corpus(portion, exp_q, exp_u, exp_c) AS (VALUES\n  " + ",\n  ".join(vals) + "\n)")
print("""
SELECT portion || ' expected ' || exp_q || ' ' || exp_u || ' ' || exp_c
               || ' but got '  || (private.portion_to_canonical(portion) ->> 'quantity')
               || ' ' || (private.portion_to_canonical(portion) ->> 'unit')
               || ' ' || (private.portion_to_canonical(portion) ->> 'confidence')
  FROM corpus
 WHERE (private.portion_to_canonical(portion) ->> 'quantity')::numeric IS DISTINCT FROM exp_q
    OR private.portion_to_canonical(portion) ->> 'unit'       IS DISTINCT FROM exp_u
    OR private.portion_to_canonical(portion) ->> 'confidence' IS DISTINCT FROM exp_c;
""")
PY

total=$(python3 -c "import json;print(len(json.load(open('supabase/tests/fixtures/portion_corpus.json'))))")
mismatches=$(docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -At -q < /tmp/portion_parity.sql)

if [[ -z "$mismatches" ]]; then
  echo "PASS  SQL converter matches all $total corpus entries"
  exit 0
fi
echo "FAIL  SQL/TS converter divergence:"
echo "$mismatches"
exit 1
