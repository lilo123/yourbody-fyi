import type { ErrorClassification } from './types';

/**
 * Classifies runtime errors from Supabase / PostgREST / network calls into:
 * - TRANSIENT: network offline, timeouts, 429, 5xx, PGRST statement timeout
 * - AUTH: 401, JWT expired, invalid refresh token
 * - PERMANENT: 23503 FK violation, 23514 check violation, 22P02, 42501 RLS,
 *              update pre-image conflicts ('deleted elsewhere', 'changed elsewhere')
 */
export function classifyError(error: unknown): ErrorClassification {
  if (!error) {
    return { kind: 'TRANSIENT', reason: 'Unknown transient error' };
  }

  // Check offline navigator status
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { kind: 'TRANSIENT', reason: 'Device is offline' };
  }

  const err = error as Record<string, any>;
  const status = Number(err.status || err.statusCode || 0);
  const code = String(err.code || '');
  const message = String(err.message || '');
  const details = String(err.details || '');
  const fullText = `${message} ${details} ${code}`.toLowerCase();

  // 1. Explicit pre-image conflicts (from set.update replay)
  if (message === 'deleted elsewhere' || message === 'changed elsewhere') {
    return {
      kind: 'PERMANENT',
      reason: message,
      code: 'CONFLICT',
    };
  }

  // 2. Refresh token failure
  if (
    fullText.includes('invalid refresh token') ||
    fullText.includes('refresh token not found') ||
    fullText.includes('refresh_token_not_found') ||
    code === 'refresh_token_not_found'
  ) {
    return {
      kind: 'AUTH',
      reason: message || 'Invalid refresh token',
      code: code || 'INVALID_REFRESH_TOKEN',
      isInvalidRefreshToken: true,
    };
  }

  // 3. JWT expired or auth 401
  if (
    status === 401 ||
    fullText.includes('jwt expired') ||
    fullText.includes('invalid jwt') ||
    fullText.includes('token expired') ||
    fullText.includes('invalid claim')
  ) {
    return {
      kind: 'AUTH',
      reason: message || 'Authentication required',
      code: code || 401,
      isInvalidRefreshToken: false,
    };
  }

  // 4. Transient network / timeout errors
  if (
    error instanceof TypeError ||
    err.name === 'TypeError' ||
    err.name === 'AbortError' ||
    fullText.includes('failed to fetch') ||
    fullText.includes('network error') ||
    fullText.includes('networkrequestfailed') ||
    fullText.includes('load failed') ||
    fullText.includes('timeout') ||
    fullText.includes('statement timeout') ||
    code === '57014' || // query_canceled / statement_timeout in Postgres
    code === 'PGRST_TIMEOUT' ||
    status === 408 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  ) {
    return {
      kind: 'TRANSIENT',
      reason: message || 'Transient network or server error',
      code: code || status || 'NETWORK_ERROR',
    };
  }

  // 5. Permanent Postgres / RLS / Schema errors
  // 23503: foreign_key_violation (e.g. exercise deleted)
  // 23514: check_violation (e.g. check constraint failure)
  // 22P02: invalid_text_representation
  // 42501: insufficient_privilege / RLS violation
  // 23505: unexpected unique_violation
  const permanentCodes = ['23503', '23514', '22P02', '42501', '23505', '42P01'];
  if (permanentCodes.includes(code)) {
    let reason = message;
    if (code === '23503') reason = 'Referenced item no longer exists (e.g. exercise deleted)';
    else if (code === '23514') reason = 'Data validation failed (check constraint)';
    else if (code === '42501') reason = 'Permission denied (RLS policy violation)';
    else if (code === '22P02') reason = 'Invalid data format';
    else if (code === '23505') reason = 'Duplicate item error';

    return {
      kind: 'PERMANENT',
      reason,
      code,
    };
  }

  // 6. Generic 4xx client errors (400, 403, 404, 422) that are permanent
  if (status >= 400 && status < 500) {
    return {
      kind: 'PERMANENT',
      reason: message || `Client error (${status})`,
      code: status,
    };
  }

  // Default to TRANSIENT if unknown
  return {
    kind: 'TRANSIENT',
    reason: message || 'Unknown error',
    code,
  };
}
