#!/usr/bin/env bash
# Production database helper.
# The password is read inline from a mode-600 file and never printed.
#
#   scripts/prod-db.sh check                     read-only connection check + live counts
#   scripts/prod-db.sh audit <file.sql>          run a SELECT-only file in a read-only session
#   scripts/prod-db.sh backup                    pg_dump public+auth, verify row counts == live
#   scripts/prod-db.sh migrate <migration.sql>   backup+verify, then apply ONE committed migration
#                                                and record it in supabase_migrations, in one transaction
#   scripts/prod-db.sh rollback <down.sql> <version>
#                                                backup+verify, apply the down file, delete the tracking row
#
# Exit codes: 0 ok, 1 failure (stop and report), 2 setup problem, 3 refused by a guard, 75 lock timeout.
#
# Rehearsal: PROD_DB_TARGET=local runs the exact same path against the local Supabase
# (127.0.0.1:58822, backups in fitness-backups/local). Rehearse every migrate/rollback locally first.
set -uo pipefail
PWF="${PROD_DB_PASSWORD_FILE:-$HOME/.config/fitness-supabase/db_password}"
HOST="${PROD_DB_HOST:-}"
PORT="${PROD_DB_PORT:-5432}"
USER_="${PROD_DB_USER:-}"
DB="${PROD_DB_NAME:-postgres}"
BACKUP_DIR="${PROD_DB_BACKUP_DIR:-$HOME/fitness-backups}"
LOCK=/tmp/fitness_prod_db.flock
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)

if [ "${PROD_DB_TARGET:-prod}" = local ]; then
  HOST=127.0.0.1; PORT=58822; USER_=postgres; DB=postgres; BACKUP_DIR="$HOME/fitness-backups/local"; LOCK=/tmp/fitness_local_db.flock
  PWF=$(mktemp); printf postgres > "$PWF"; chmod 600 "$PWF"; export PGSSLMODE=disable PGCONNECT_TIMEOUT=15
  echo "TARGET=local (rehearsal)"
else
  [ -n "$HOST" ] || { echo "MISSING_ENV_VAR: PROD_DB_HOST is required for production operations"; exit 2; }
  [ -n "$USER_" ] || { echo "MISSING_ENV_VAR: PROD_DB_USER is required for production operations"; exit 2; }
  [ -s "$PWF" ] || { echo "NO_PASSWORD_FILE ($PWF)"; exit 2; }
  [ "$(stat -c %a "$PWF")" = 600 ] || { echo "PASSWORD_FILE_MODE_NOT_600"; exit 2; }
  export PGSSLMODE=require PGCONNECT_TIMEOUT=15
  echo "TARGET=production"
fi

# One production-DB operation at a time, across all sessions; released automatically if the process dies.
exec 9>"$LOCK"
flock -w 600 9 || { echo "PROD_DB_LOCK_TIMEOUT"; exit 75; }

q()  { PGPASSWORD="$(cat "$PWF")" psql -h $HOST -p $PORT -U $USER_ -d $DB -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }
# Read-only: an explicit READ ONLY transaction (the pooler ignores PGOPTIONS startup settings).
qro(){ local f; f=$(mktemp); { echo "begin read only;"; if [ "$1" = -c ]; then echo "$2;"; else cat "$2"; fi; echo "rollback;"; } > "$f"
       q -f "$f" | grep -vxE "BEGIN|ROLLBACK"; local rc=${PIPESTATUS[0]}; rm -f "$f"; return $rc; }
counts(){ qro -c "select 'workouts='||(select count(*) from public.workouts)||' sets='||(select count(*) from public.sets)||' users='||(select count(*) from public.users)||' exercises='||(select count(*) from public.exercises)||' nutrition_logs='||(select count(*) from public.nutrition_logs)"; }

backup(){
  mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
  local out="$BACKUP_DIR/prod-$(date -u +%Y%m%dT%H%M%SZ).dump" live dumped
  live=$(counts) || { echo "CONNECT_FAIL"; return 1; }
  PGPASSWORD="$(cat "$PWF")" pg_dump -h $HOST -p $PORT -U $USER_ -d $DB --format=custom --no-owner --no-privileges \
    --schema=public --schema=auth --schema=private --file="$out" || { echo "DUMP_FAIL"; rm -f "$out"; return 1; }
  chmod 600 "$out"
  n(){ pg_restore --data-only --schema=public --table="$1" -f - "$out" 2>/dev/null | awk '/^COPY /{c=1;next} /^\\\.$/{c=0} c' | wc -l; }
  dumped="workouts=$(n workouts) sets=$(n sets) users=$(n users) exercises=$(n exercises) nutrition_logs=$(n nutrition_logs)"
  echo "backup: $out ($(du -h "$out" | cut -f1))"; echo "live:   $live"; echo "dumped: $dumped"
  [ "$live" = "$dumped" ] || { echo "BACKUP_MISMATCH"; return 1; }
  echo "BACKUP_VERIFIED"
}

committed(){  # file must be tracked and identical to HEAD
  local f="$1"
  git -C "$REPO" ls-files --error-unmatch "$f" >/dev/null 2>&1 || { echo "REFUSED: $f is not tracked in git"; return 3; }
  git -C "$REPO" diff --quiet HEAD -- "$f" || { echo "REFUSED: $f has uncommitted changes"; return 3; }
  grep -qiE '^\s*(begin|commit|rollback)\s*;' "$f" && { echo "REFUSED: $f contains explicit BEGIN/COMMIT/ROLLBACK (the helper wraps one transaction)"; return 3; }
  return 0
}

case "${1:-check}" in
  check)
    qro -c "select 'connected as '||current_user||', server '||current_setting('server_version')||', read_only='||current_setting('transaction_read_only')" || { echo "CONNECT_FAIL"; exit 1; }
    echo "live: $(counts)"
    echo "migrations recorded: $(qro -c "select count(*)||', latest '||max(version) from supabase_migrations.schema_migrations")";;
  audit)
    f="${2:?usage: audit <file.sql>}"; [ -f "$f" ] || { echo "NO_FILE $f"; exit 2; }
    qro -f "$f" || { echo "AUDIT_FAIL"; exit 1; };;
  backup)
    backup || exit 1;;
  migrate)
    f="${2:?usage: migrate <supabase/migrations/<version>_<name>.sql>}"
    case "$f" in */supabase/migrations/*.sql|supabase/migrations/*.sql) ;; *) echo "REFUSED: not under supabase/migrations/"; exit 3;; esac
    f=$(realpath "$f"); base=$(basename "$f" .sql); ver=${base%%_*}; name=${base#*_}
    committed "$f" || exit 3
    [ "$(qro -c "select count(*) from supabase_migrations.schema_migrations where version='$ver'")" = 0 ] || { echo "REFUSED: version $ver already applied"; exit 3; }
    backup || { echo "STOP: no verified backup, migration not applied"; exit 1; }
    tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
    { echo "\\i $f"
      echo "insert into supabase_migrations.schema_migrations(version, name, statements) values ('$ver', '$name', array[\$mig\$$(cat "$f")\$mig\$]);"
    } > "$tmp"
    q -1 -f "$tmp" && echo "MIGRATION_APPLIED $ver $name" || { echo "MIGRATION_FAILED $ver (transaction rolled back)"; exit 1; }
    echo "live after: $(counts)";;
  rollback)
    f=$(realpath "${2:?usage: rollback <down.sql> <version>}"); ver="${3:?version}"
    committed "$f" || exit 3
    backup || { echo "STOP: no verified backup, rollback not applied"; exit 1; }
    tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
    { echo "\\i $f"; echo "delete from supabase_migrations.schema_migrations where version='$ver';"; } > "$tmp"
    q -1 -f "$tmp" && echo "ROLLBACK_APPLIED $ver" || { echo "ROLLBACK_FAILED $ver (transaction rolled back)"; exit 1; };;
  *) echo "unknown command"; exit 2;;
esac
