import { describe, it, expect, vi, afterEach } from 'vitest';

describe('supabase client environment configuration', () => {
  const originalEnv = { ...import.meta.env };

  afterEach(() => {
    (import.meta.env as any).PROD = originalEnv.PROD;
    (import.meta.env as any).DEV = originalEnv.DEV;
    (import.meta.env as any).VITE_SUPABASE_URL = originalEnv.VITE_SUPABASE_URL;
    (import.meta.env as any).VITE_SUPABASE_ANON_KEY = originalEnv.VITE_SUPABASE_ANON_KEY;
    vi.resetModules();
  });

  it('exports a supabase client when in development', async () => {
    (import.meta.env as any).PROD = false;
    (import.meta.env as any).DEV = true;
    (import.meta.env as any).VITE_SUPABASE_URL = '';
    (import.meta.env as any).VITE_SUPABASE_ANON_KEY = '';
    const { supabase } = await import('./supabase');
    expect(supabase).toBeDefined();
    expect(supabase.auth).toBeDefined();
    expect((supabase as any).supabaseUrl).toBe('http://127.0.0.1:58821');
  });

  it('fails fast with a descriptive error in production if VITE_SUPABASE_URL is missing', async () => {
    vi.resetModules();
    (import.meta.env as any).PROD = true;
    (import.meta.env as any).DEV = false;
    delete (import.meta.env as any).VITE_SUPABASE_URL;
    (import.meta.env as any).VITE_SUPABASE_ANON_KEY = 'valid-key';

    await expect(async () => {
      await import('./supabase');
    }).rejects.toThrow('VITE_SUPABASE_URL is required in production environment');
  });

  it('fails fast with a descriptive error in production if VITE_SUPABASE_ANON_KEY is missing', async () => {
    vi.resetModules();
    (import.meta.env as any).PROD = true;
    (import.meta.env as any).DEV = false;
    (import.meta.env as any).VITE_SUPABASE_URL = 'https://my-prod-project.supabase.co';
    delete (import.meta.env as any).VITE_SUPABASE_ANON_KEY;

    await expect(async () => {
      await import('./supabase');
    }).rejects.toThrow('VITE_SUPABASE_ANON_KEY is required in production environment');
  });

  it('fails fast with a descriptive error in production if VITE_SUPABASE_ANON_KEY is empty string', async () => {
    vi.resetModules();
    (import.meta.env as any).PROD = true;
    (import.meta.env as any).DEV = false;
    (import.meta.env as any).VITE_SUPABASE_URL = 'https://my-prod-project.supabase.co';
    (import.meta.env as any).VITE_SUPABASE_ANON_KEY = '';

    await expect(async () => {
      await import('./supabase');
    }).rejects.toThrow('VITE_SUPABASE_ANON_KEY is required in production environment');
  });

  it('succeeds in production when both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are provided', async () => {
    vi.resetModules();
    (import.meta.env as any).PROD = true;
    (import.meta.env as any).DEV = false;
    (import.meta.env as any).VITE_SUPABASE_URL = 'https://my-prod-project.supabase.co';
    (import.meta.env as any).VITE_SUPABASE_ANON_KEY = 'valid-prod-anon-key';

    const { supabase } = await import('./supabase');
    expect(supabase).toBeDefined();
    expect((supabase as any).supabaseUrl).toBe('https://my-prod-project.supabase.co');
  });

  it('does not apply development fallbacks when DEV is false outside production', async () => {
    vi.resetModules();
    (import.meta.env as any).PROD = false;
    (import.meta.env as any).DEV = false;
    (import.meta.env as any).VITE_SUPABASE_URL = '';
    (import.meta.env as any).VITE_SUPABASE_ANON_KEY = '';

    await expect(async () => {
      await import('./supabase');
    }).rejects.toThrow(/supabaseUrl is required/i);
  });
});

