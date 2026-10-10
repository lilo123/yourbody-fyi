export const SENTRY_INGEST_ORIGIN = 'https://o4512229258690560.ingest.us.sentry.io';

export function getWsOrigin(parsed: URL): string | null {
  if (parsed.protocol === 'https:') {
    return `wss://${parsed.host}`;
  }
  if (parsed.protocol === 'http:') {
    return `ws://${parsed.host}`;
  }
  return null;
}

export function buildCspConnectSrcPolicy(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const origin = parsed.origin;
  if (!origin || origin === 'null') {
    return null;
  }

  const wsOrigin = getWsOrigin(parsed);
  if (!wsOrigin) {
    return null;
  }

  return `connect-src 'self' ${origin} ${wsOrigin} ${SENTRY_INGEST_ORIGIN} capacitor://localhost`;
}
