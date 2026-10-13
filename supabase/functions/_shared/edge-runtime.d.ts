// Portions derived from @supabase/functions-js (MIT License, Copyright (c) Supabase)
// Minimal ambient definitions for Supabase Edge Runtime.

declare namespace EdgeRuntime {
  function waitUntil<T>(promise: Promise<T>): Promise<T>;
}
