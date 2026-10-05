import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const vercelConfigPath = path.join(rootDir, 'vercel.json');

const BANNED_LOOPBACK_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\.0\.0\.1/i,
  /^wss?:\/\/localhost/i,
  /^wss?:\/\/127\.0\.0\.1/i,
];

function isBannedLoopback(token) {
  const cleanToken = token.trim().replace(/^['"]|['"]$/g, '');
  return BANNED_LOOPBACK_PATTERNS.some((pattern) => pattern.test(cleanToken));
}

function checkCsp() {
  if (!fs.existsSync(vercelConfigPath)) {
    console.error(`FAIL: vercel.json not found at ${vercelConfigPath}`);
    process.exit(1);
  }

  let vercelConfig;
  try {
    const raw = fs.readFileSync(vercelConfigPath, 'utf8');
    vercelConfig = JSON.parse(raw);
  } catch (err) {
    console.error(`FAIL: Failed to parse vercel.json: ${err.message}`);
    process.exit(1);
  }

  const violations = [];
  const headersSections = Array.isArray(vercelConfig.headers) ? vercelConfig.headers : [];

  for (let i = 0; i < headersSections.length; i++) {
    const section = headersSections[i];
    const source = section.source || `headers[${i}]`;
    const headersList = Array.isArray(section.headers) ? section.headers : [];

    for (const header of headersList) {
      const key = (header.key || '').trim();
      const val = (header.value || '').trim();

      if (key.toLowerCase() === 'x-xss-protection') {
        violations.push(
          `[X-XSS-Protection] Deprecated header "${key}: ${val}" found in route "${source}".`
        );
      }

      if (key.toLowerCase() === 'content-security-policy') {
        const directives = val.split(';').map((d) => d.trim()).filter(Boolean);
        for (const directive of directives) {
          const tokens = directive.split(/\s+/).filter(Boolean);
          if (tokens.length === 0) continue;
          const directiveName = tokens[0].toLowerCase();
          if (directiveName === 'connect-src') {
            const sourceTokens = tokens.slice(1);
            for (const token of sourceTokens) {
              if (isBannedLoopback(token)) {
                violations.push(
                  `[CSP connect-src] Banned loopback origin "${token}" found in route "${source}".`
                );
              }
            }
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(`CSP check failed with ${violations.length} violation(s):`);
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }

  console.log('CSP check passed: No deprecated X-XSS-Protection headers and no banned loopback origins in connect-src.');
  process.exit(0);
}

checkCsp();
