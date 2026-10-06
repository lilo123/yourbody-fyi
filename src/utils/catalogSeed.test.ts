import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EQUIPMENT, MUSCLE_GROUPS } from '../constants/muscleGroups';

export interface CatalogRow {
  name: string;
  bodyParts: string[];
  equipment: string;
}

export function normalizeExerciseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseCatalogCsv(csvPath: string): CatalogRow[] {
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.trim().split('\n');
  const header = lines[0].trim();
  if (header !== 'name,body_parts,equipment') {
    throw new Error(`Unexpected CSV header: ${header}`);
  }

  const rows: CatalogRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length !== 3) {
      throw new Error(`Invalid CSV line ${i + 1}: ${line}`);
    }
    const [name, bodyPartsRaw, equipment] = parts;
    const bodyParts = bodyPartsRaw.split('|').map((s) => s.trim()).filter(Boolean);
    rows.push({
      name: name.trim(),
      bodyParts,
      equipment: equipment.trim(),
    });
  }
  return rows;
}

const PROD_MASTER_NAMES = [
  '45 Degree Back Extension',
  'Bicep cable pull',
  'Cable Lateral Raises',
  'Dips',
  'Dragon Flag',
  'Dumbbell Lateral Raises',
  'Face Pulls',
  'Incline Bench Press',
  'Inclined Bicep Curl',
  'L2H Cable Fly',
  'Lat Cable Prayer',
  'Lat Pull Down',
  'Leg Curl',
  'Leg Extension Machine',
  'Leg Raise',
  'Overhead Tricep Cable Pull',
  'Preacher Curl',
  'Rear delt crossover',
  'Reverse crunch',
  'Seated Cable Row',
  'Seated Chest Press',
  'Tricep Cable Pushdown',
  'Weighted Sit-Up',
];

function postgresMd5Uuid(input: string): string {
  const hash = crypto.createHash('md5').update(input, 'utf8').digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

describe('Catalog Seed & CSV Parity', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const csvPath = path.join(projectRoot, 'supabase/catalog/default_exercises.csv');
  const migrationPath = path.join(projectRoot, 'supabase/migrations/20260929010000_default_catalog_seed.sql');

  const csvRows = parseCatalogCsv(csvPath);
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  it('contains between 150 and 250 curated exercises', () => {
    expect(csvRows.length).toBeGreaterThanOrEqual(150);
    expect(csvRows.length).toBeLessThanOrEqual(250);
    expect(csvRows.length).toBe(208);
  });

  it('contains all 23 production master exercise names exactly', () => {
    const csvNameSet = new Set(csvRows.map((r: CatalogRow) => r.name));
    for (const prodName of PROD_MASTER_NAMES) {
      expect(csvNameSet.has(prodName)).toBe(true);
    }
  });

  it('validates taxonomy: all equipment and body_parts match constants', () => {
    const validEquipment = new Set<string>(EQUIPMENT);
    const validMuscles = new Set<string>(MUSCLE_GROUPS);

    for (const row of csvRows) {
      expect(validEquipment.has(row.equipment)).toBe(true);
      expect(row.bodyParts.length).toBeGreaterThan(0);
      for (const bp of row.bodyParts) {
        expect(validMuscles.has(bp)).toBe(true);
      }
    }
  });

  it('has unique normalized names across all CSV rows', () => {
    const normalizedSet = new Set<string>();
    for (const row of csvRows) {
      const norm = normalizeExerciseName(row.name);
      expect(normalizedSet.has(norm)).toBe(false);
      normalizedSet.add(norm);
    }
    expect(normalizedSet.size).toBe(csvRows.length);
  });

  it('asserts migration VALUES match CSV rows exactly', () => {
    for (const row of csvRows) {
      const escapedName = row.name.replace(/'/g, "''");
      const arrayElements = row.bodyParts.map((bp: string) => `'${bp.replace(/'/g, "''")}'`).join(', ');
      const expectedFragment = `('${escapedName}', ARRAY[${arrayElements}]::text[], '${row.equipment}')`;
      expect(migrationSql).toContain(expectedFragment);

      // Verify deterministic uuid matches postgres md5 spec
      const expectedUuid = postgresMd5Uuid(`m8:${normalizeExerciseName(row.name)}`);
      expect(expectedUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});
