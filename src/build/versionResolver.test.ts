import { describe, expect, it } from 'vitest';
import { resolveCommitSha } from './versionResolver.ts';

describe('versionResolver', () => {
  it('returns VERCEL_GIT_COMMIT_SHA when present', () => {
    const env = {
      VERCEL_GIT_COMMIT_SHA: 'vercel-sha-123',
      CF_PAGES_COMMIT_SHA: 'cf-sha-456',
      GITHUB_SHA: 'github-sha-789',
    };
    expect(resolveCommitSha(env)).toBe('vercel-sha-123');
  });

  it('prefers CF_PAGES_COMMIT_SHA when VERCEL_GIT_COMMIT_SHA is missing', () => {
    const env = {
      CF_PAGES_COMMIT_SHA: 'cf-sha-456',
      GITHUB_SHA: 'github-sha-789',
    };
    expect(resolveCommitSha(env)).toBe('cf-sha-456');
  });

  it('prefers GITHUB_SHA when VERCEL and CF are missing', () => {
    const env = {
      GITHUB_SHA: 'github-sha-789',
    };
    expect(resolveCommitSha(env)).toBe('github-sha-789');
  });

  it('returns "dev" when no env vars are defined', () => {
    expect(resolveCommitSha({})).toBe('dev');
  });

  it('falls back through empty strings to next available variable', () => {
    const env = {
      VERCEL_GIT_COMMIT_SHA: '',
      CF_PAGES_COMMIT_SHA: 'cf-pages-sha',
    };
    expect(resolveCommitSha(env)).toBe('cf-pages-sha');
  });
});
