import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

export function normalizeExerciseName(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseCatalogCsv(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.trim().split('\n');
  const header = lines[0].trim();
  if (header !== 'name,body_parts,equipment') {
    throw new Error(`Unexpected CSV header: ${header}`);
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length !== 3) {
      throw new Error(`Invalid CSV line ${i + 1}: ${line}`);
    }
    const [name, bodyPartsRaw, equipment] = parts;
    const bodyParts = bodyPartsRaw.split('|').map(s => s.trim()).filter(Boolean);
    rows.push({
      name: name.trim(),
      bodyParts,
      equipment: equipment.trim(),
    });
  }
  return rows;
}

export function generateMigrationSql(rows) {
  const valuesLines = rows.map((r) => {
    const escapedName = r.name.replace(/'/g, "''");
    const arrayStr = `ARRAY[${r.bodyParts.map(bp => `'${bp.replace(/'/g, "''")}'`).join(', ')}]::text[]`;
    const escapedEq = r.equipment.replace(/'/g, "''");
    return `    ('${escapedName}', ${arrayStr}, '${escapedEq}')`;
  });

  return `-- Migration: 20260929010000_default_catalog_seed.sql
-- Description: M8 default catalog seed and equipment backfill (D-P7b-3, L48)
-- 1. Create tracking table public.catalog_seed_backfill(exercise_id uuid PK) with RLS enabled and no grants
-- 2. Backfill equipment ONLY on master exercises where equipment IS NULL and normalized names match CSV
-- 3. Insert curated master exercises with deterministic IDs md5('m8:' || normalize_exercise_name(name))::uuid,
--    skipping any name that normalizes-equal to ANY existing row (any owner, active or archived).

-- 1. Tracking table for backfilled rows
CREATE TABLE IF NOT EXISTS public.catalog_seed_backfill (
  exercise_id uuid PRIMARY KEY REFERENCES public.exercises(id) ON DELETE CASCADE
);

ALTER TABLE public.catalog_seed_backfill ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_seed_backfill FROM anon, authenticated;

-- 2. Backfill equipment on existing master rows with NULL equipment
WITH csv_rows(name, body_parts, equipment) AS (
  VALUES
${valuesLines.join(',\n')}
),
updated_rows AS (
  UPDATE public.exercises e
  SET equipment = c.equipment
  FROM csv_rows c
  WHERE e.is_master = true
    AND e.equipment IS NULL
    AND public.normalize_exercise_name(e.name) = public.normalize_exercise_name(c.name)
  RETURNING e.id
)
INSERT INTO public.catalog_seed_backfill (exercise_id)
SELECT id FROM updated_rows
ON CONFLICT (exercise_id) DO NOTHING;

-- 3. Insert curated master defaults with deterministic IDs
WITH csv_rows(name, body_parts, equipment) AS (
  VALUES
${valuesLines.join(',\n')}
)
INSERT INTO public.exercises (id, name, body_parts, body_part, equipment, is_master, user_id, is_archived)
SELECT
  md5('m8:' || public.normalize_exercise_name(c.name))::uuid,
  c.name,
  c.body_parts,
  array_to_string(c.body_parts, ', '),
  c.equipment,
  true,
  NULL,
  false
FROM csv_rows c
WHERE NOT EXISTS (
  SELECT 1 FROM public.exercises e
  WHERE public.normalize_exercise_name(e.name) = public.normalize_exercise_name(c.name)
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
`;
}

export function generateRollbackSql(rows) {
  const nameValues = rows.map((r) => {
    const escapedName = r.name.replace(/'/g, "''");
    return `    ('${escapedName}')`;
  });

  return `-- Rollback: 20260929010000_default_catalog_seed.down.sql
-- Restores pre-migration M8 state (D-P7b-3)

WITH csv_rows(name) AS (
  VALUES
${nameValues.join(',\n')}
)
DELETE FROM public.exercises
WHERE id IN (
  SELECT md5('m8:' || public.normalize_exercise_name(c.name))::uuid
  FROM csv_rows c
)
AND id NOT IN (SELECT exercise_id FROM public.sets WHERE exercise_id IS NOT NULL)
AND id NOT IN (SELECT exercise_id FROM public.template_exercises WHERE exercise_id IS NOT NULL);

-- Restore NULL equipment on backfilled rows
UPDATE public.exercises
SET equipment = NULL
WHERE id IN (SELECT exercise_id FROM public.catalog_seed_backfill);

DROP TABLE IF EXISTS public.catalog_seed_backfill;

NOTIFY pgrst, 'reload schema';
`;
}

// CLI execution
if (process.argv[1] === __filename) {
  const csvPath = path.join(projectRoot, 'supabase/catalog/default_exercises.csv');
  const migrationPath = path.join(projectRoot, 'supabase/migrations/20260929010000_default_catalog_seed.sql');
  const rollbackPath = path.join(projectRoot, 'supabase/rollbacks/20260929010000_default_catalog_seed.down.sql');

  const rows = parseCatalogCsv(csvPath);
  console.log(`Parsed ${rows.length} rows from ${csvPath}`);

  const migrationSql = generateMigrationSql(rows);
  fs.writeFileSync(migrationPath, migrationSql, 'utf8');
  console.log(`Generated migration at ${migrationPath}`);

  const rollbackSql = generateRollbackSql(rows);
  fs.writeFileSync(rollbackPath, rollbackSql, 'utf8');
  console.log(`Generated rollback at ${rollbackPath}`);
}
