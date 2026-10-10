import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const vercelConfigPath = path.join(rootDir, 'vercel.json');
const headersConfigPath = path.join(rootDir, 'public', '_headers');
const distIndexPath = path.join(rootDir, 'dist', 'index.html');

const SENTRY_INGEST_HOST = 'https://o4512229258690560.ingest.us.sentry.io';

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

function decodeHtmlEntities(value) {
  return value
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function extractMetaContent(metaTag) {
  const doubleQuoteMatch = metaTag.match(/content="([^"]*)"/i);
  if (doubleQuoteMatch) {
    return decodeHtmlEntities(doubleQuoteMatch[1]);
  }
  const singleQuoteMatch = metaTag.match(/content='([^']*)'/i);
  if (singleQuoteMatch) {
    return decodeHtmlEntities(singleQuoteMatch[1]);
  }
  return null;
}

function parseHeadersFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const rules = [];
  let currentRule = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (!rawLine.startsWith(' ') && !rawLine.startsWith('\t')) {
      currentRule = { pattern: line, headers: [] };
      rules.push(currentRule);
    } else if (currentRule) {
      currentRule.headers.push(line);
    }
  }

  return rules;
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
  let vercelCsp = null;

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
        if (source === '/(.*)') {
          vercelCsp = val;
        }
        const directives = val.split(';').map((directive) => directive.trim()).filter(Boolean);
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
            if (!sourceTokens.includes(SENTRY_INGEST_HOST)) {
              violations.push(
                `[CSP connect-src] Sentry ingest host "${SENTRY_INGEST_HOST}" missing in route "${source}".`
              );
            }
          }
        }
      }
    }
  }

  // Verify public/_headers parity with vercel.json
  const headersRules = parseHeadersFile(headersConfigPath);
  if (!headersRules) {
    violations.push(`FAIL: public/_headers not found at ${headersConfigPath}`);
  } else {
    let headersCsp = null;
    const globalRule = headersRules.find((rule) => rule.pattern === '/*');
    if (globalRule) {
      for (const headerLine of globalRule.headers) {
        const colonIdx = headerLine.indexOf(':');
        if (colonIdx !== -1) {
          const key = headerLine.slice(0, colonIdx).trim().toLowerCase();
          const val = headerLine.slice(colonIdx + 1).trim();
          if (key === 'content-security-policy') {
            headersCsp = val;
            break;
          }
        }
      }
    }

    if (!headersCsp) {
      violations.push(
        '[Headers CSP] Content-Security-Policy missing in public/_headers for /* route.'
      );
    } else if (vercelCsp) {
      const normalize = (str) => str.trim().replace(/\s+/g, ' ');
      if (normalize(headersCsp) !== normalize(vercelCsp)) {
        violations.push(
          `[Headers CSP] CSP in public/_headers does not match vercel.json.\n  Expected: ${vercelCsp}\n  Observed: ${headersCsp}`
        );
      }
    }

    const expectedNoCachePaths = [
      '/sw.js',
      '/workbox-*',
      '/manifest.webmanifest',
      '/index.html',
      '/version.json',
    ];

    for (const expectedPath of expectedNoCachePaths) {
      const rule = headersRules.find((candidate) => candidate.pattern === expectedPath);
      if (!rule) {
        violations.push(
          `[Headers no-cache] Expected no-cache route "${expectedPath}" not found in public/_headers.`
        );
      } else {
        const hasNoCache = rule.headers.some((headerLine) => {
          const colonIdx = headerLine.indexOf(':');
          if (colonIdx === -1) return false;
          const key = headerLine.slice(0, colonIdx).trim().toLowerCase();
          const val = headerLine.slice(colonIdx + 1).trim().toLowerCase();
          return key === 'cache-control' && val === 'no-cache';
        });
        if (!hasNoCache) {
          violations.push(
            `[Headers no-cache] Route "${expectedPath}" in public/_headers is missing "Cache-Control: no-cache".`
          );
        }
      }
    }
  }

  // Verify built dist/index.html meta CSP policy
  const supabaseEnvUrl = process.env.VITE_SUPABASE_URL ? process.env.VITE_SUPABASE_URL.trim() : '';

  if (supabaseEnvUrl) {
    if (!fs.existsSync(distIndexPath)) {
      violations.push(
        `[Meta CSP] dist/index.html not found at ${distIndexPath} while VITE_SUPABASE_URL is set.`
      );
    } else {
      const htmlContent = fs.readFileSync(distIndexPath, 'utf8');
      const metaTagMatch = htmlContent.match(
        /<meta\s+[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i
      );

      if (!metaTagMatch) {
        violations.push(
          '[Meta CSP] dist/index.html is missing <meta http-equiv="Content-Security-Policy"> tag when VITE_SUPABASE_URL is set.'
        );
      } else {
        const metaTag = metaTagMatch[0];
        const metaPolicy = extractMetaContent(metaTag);
        if (!metaPolicy) {
          violations.push(
            '[Meta CSP] Meta Content-Security-Policy tag is missing a content attribute.'
          );
        } else {
          // (b) No wildcard *.supabase.co in meta policy
          if (/\*\.supabase\.co/i.test(metaPolicy)) {
            violations.push(
              '[Meta CSP] Wildcard *.supabase.co found in meta CSP policy. It must be pinned to the exact project origin.'
            );
          }

          // (c) Sentry ingest host must be allowed in meta policy
          if (!metaPolicy.includes(SENTRY_INGEST_HOST)) {
            violations.push(
              `[Meta CSP] Sentry ingest host "${SENTRY_INGEST_HOST}" missing in meta CSP policy.`
            );
          }

          // (a) Exact origin and ws origin derived from VITE_SUPABASE_URL
          try {
            const parsedUrl = new URL(supabaseEnvUrl);
            const expectedOrigin = parsedUrl.origin;
            const expectedWsProtocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
            const expectedWsOrigin = `${expectedWsProtocol}//${parsedUrl.host}`;

            const metaDirectives = metaPolicy.split(';').map((directive) => directive.trim()).filter(Boolean);
            let connectSrcTokens = [];
            for (const directive of metaDirectives) {
              const tokens = directive.split(/\s+/).filter(Boolean);
              if (tokens.length > 0 && tokens[0].toLowerCase() === 'connect-src') {
                connectSrcTokens = tokens.slice(1);
                break;
              }
            }

            if (!connectSrcTokens.includes(expectedOrigin)) {
              violations.push(
                `[Meta CSP] Expected exact Supabase origin "${expectedOrigin}" not found in meta connect-src.`
              );
            }

            if (!connectSrcTokens.includes(expectedWsOrigin)) {
              violations.push(
                `[Meta CSP] Expected exact Supabase WebSocket origin "${expectedWsOrigin}" not found in meta connect-src.`
              );
            }
          } catch (parseErr) {
            violations.push(
              `[Meta CSP] Failed to parse VITE_SUPABASE_URL ("${supabaseEnvUrl}"): ${parseErr.message}`
            );
          }
        }
      }
    }
  } else if (fs.existsSync(distIndexPath)) {
    const htmlContent = fs.readFileSync(distIndexPath, 'utf8');
    const metaTagMatch = htmlContent.match(
      /<meta\s+[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i
    );
    if (metaTagMatch) {
      const metaPolicy = extractMetaContent(metaTagMatch[0]);
      if (metaPolicy) {
        if (/\*\.supabase\.co/i.test(metaPolicy)) {
          violations.push(
            '[Meta CSP] Wildcard *.supabase.co found in meta CSP policy.'
          );
        }
        if (!metaPolicy.includes(SENTRY_INGEST_HOST)) {
          violations.push(
            `[Meta CSP] Sentry ingest host "${SENTRY_INGEST_HOST}" missing in meta CSP policy.`
          );
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(`CSP check failed with ${violations.length} violation(s):`);
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exit(1);
  }

  console.log('CSP check passed: No deprecated X-XSS-Protection headers, no banned loopback origins in vercel.json, public/_headers matches vercel.json CSP and cache rules, and meta CSP correctly pins origin.');
  process.exit(0);
}

checkCsp();
