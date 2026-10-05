import { execSync } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

try {
  const out = execSync(
    "grep -rn 'queryKey:' src --include=*.ts --include=*.tsx | grep -v '\\.test\\.' | grep -v invalidateQueries",
    { cwd: rootDir, encoding: 'utf8' }
  );
  const lines = out.split('\n').filter(Boolean);
  const keys = lines.map((l) => l.split('queryKey:')[1].trim());
  const seen = {};
  let bad = 0;
  for (const k of keys) {
    if (seen[k]) {
      console.log('COLLISION', k);
      bad++;
    }
    seen[k] = (seen[k] || 0) + 1;
  }
  console.log(`KEYCOUNT ${keys.length} / COLLISIONS ${bad}`);
  if (bad > 0) {
    process.exit(1);
  } else {
    console.log('EXIT=0');
    process.exit(0);
  }
} catch (err) {
  if (err.status === 1 && !err.stdout) {
    console.log('No query keys found.');
    process.exit(0);
  }
  console.error('Error running check-cache-collisions:', err);
  process.exit(1);
}
