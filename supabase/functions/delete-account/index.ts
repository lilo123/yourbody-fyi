import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isAllowedOrigin, getCorsHeaders as getBaseCorsHeaders } from "../_shared/cors.ts";

export { isAllowedOrigin };

export function getCorsHeaders(origin: string | null | undefined): Record<string, string> {
  return getBaseCorsHeaders(origin, {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  });
}

export default {
  async fetch(req: Request): Promise<Response> {
    const origin = req.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);

    if (origin && !isAllowedOrigin(origin)) {
      return new Response(
        JSON.stringify({ error: 'CORS origin not allowed', code: 'cors_not_allowed' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed', code: 'method_not_allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify Authorization header presence and Bearer token format
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Authorization header. Authentication required.', code: 'unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

      if (!supabaseUrl || !anonKey || !serviceRoleKey) {
        throw new Error('Supabase environment variables not configured');
      }

      // 1. Verify caller authentication via Supabase Auth
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized: Invalid token', code: 'unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 2. Parse and validate request body
      let body: any;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: 'Malformed JSON or payload too large.', code: 'confirmation_required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!body || typeof body !== 'object' || body.confirm !== 'DELETE') {
        return new Response(
          JSON.stringify({ error: 'Confirmation required', code: 'confirmation_required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 3. Server-side flag check: app_config 'account_deletion_enabled' with user client
      const { data: configRow, error: configError } = await userClient
        .from('app_config')
        .select('value')
        .eq('key', 'account_deletion_enabled')
        .maybeSingle();

      if (configError || !configRow || configRow.value !== true) {
        return new Response(
          JSON.stringify({ error: 'Feature disabled', code: 'feature_disabled' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 4. Initialize service role client for privileged administrative operations
      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // 5. Stripe subscription cancellation if configured
      const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
      if (stripeSecretKey) {
        const isLiveKey = stripeSecretKey.startsWith('sk_live_') || stripeSecretKey.startsWith('rk_live_');
        const liveEnabled = Deno.env.get('STRIPE_LIVE_ENABLED') === 'true';
        if (isLiveKey && !liveEnabled) {
          throw new Error('Live Stripe keys are not permitted');
        }
        try {
          const { data: userProfile, error: profileErr } = await adminClient
            .from('users')
            .select('billing_customer_id')
            .eq('id', user.id)
            .maybeSingle();

          if (!profileErr && userProfile && typeof (userProfile as any).billing_customer_id === 'string') {
            const customerId = (userProfile as any).billing_customer_id.trim();
            if (customerId) {
              const listRes = await fetch(
                `https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all`,
                {
                  headers: { Authorization: `Bearer ${stripeSecretKey}` },
                }
              );
              if (listRes.ok) {
                const subPayload = await listRes.json();
                const subscriptions = Array.isArray(subPayload?.data) ? subPayload.data : [];
                for (const sub of subscriptions) {
                  if (sub?.id && ['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)) {
                    await fetch(
                      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(sub.id)}`,
                      {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${stripeSecretKey}` },
                      }
                    );
                  }
                }
              }
            }
          }
        } catch {
          // billing_customer_id column may not exist on this base; gracefully proceed
        }
      }

      // 6. Clean up RESTRICT-blocked rows strictly scoped to this user
      // A. Template exercises & routine templates owned by this user
      const { data: templates } = await adminClient
        .from('routine_templates')
        .select('id')
        .eq('user_id', user.id);

      if (templates && templates.length > 0) {
        const templateIds = templates.map((t: { id: string }) => t.id);
        await adminClient
          .from('template_exercises')
          .delete()
          .in('template_id', templateIds);
        await adminClient
          .from('routine_templates')
          .delete()
          .eq('user_id', user.id);
      }

      // B. Sets & workouts owned by this user
      const { data: workouts } = await adminClient
        .from('workouts')
        .select('id')
        .eq('user_id', user.id);

      if (workouts && workouts.length > 0) {
        const workoutIds = workouts.map((w: { id: string }) => w.id);
        await adminClient
          .from('sets')
          .delete()
          .in('workout_id', workoutIds);
        await adminClient
          .from('workouts')
          .delete()
          .eq('user_id', user.id);
      }

      // C. Custom exercises owned by this user: clone-and-repoint for external references
      // For any custom exercise E owned by this user that is referenced by other users'
      // template_exercises or sets:
      // 1. Clone E for each referencing other user U (owned by U, is_master = false).
      // 2. Repoint U's referencing rows to the clone.
      // 3. Delete E from public.exercises.
      const { data: exercises } = await adminClient
        .from('exercises')
        .select('*')
        .eq('user_id', user.id);

      if (exercises && exercises.length > 0) {
        for (const ex of exercises) {
          // Find referencing template_exercises belonging to other users
          const { data: refTemplates } = await adminClient
            .from('template_exercises')
            .select('id, routine_templates!inner(id, user_id)')
            .eq('exercise_id', ex.id);

          // Find referencing sets belonging to other users
          const { data: refSets } = await adminClient
            .from('sets')
            .select('id, workouts!inner(id, user_id)')
            .eq('exercise_id', ex.id);

          const otherUserMap = new Map<string, { teIds: string[]; setIds: string[] }>();

          if (refTemplates) {
            for (const t of refTemplates) {
              const otherUid = (t.routine_templates as any)?.user_id;
              if (otherUid && otherUid !== user.id) {
                if (!otherUserMap.has(otherUid)) {
                  otherUserMap.set(otherUid, { teIds: [], setIds: [] });
                }
                otherUserMap.get(otherUid)!.teIds.push(t.id);
              }
            }
          }

          if (refSets) {
            for (const s of refSets) {
              const otherUid = (s.workouts as any)?.user_id;
              if (otherUid && otherUid !== user.id) {
                if (!otherUserMap.has(otherUid)) {
                  otherUserMap.set(otherUid, { teIds: [], setIds: [] });
                }
                otherUserMap.get(otherUid)!.setIds.push(s.id);
              }
            }
          }

          // For each other user, ensure they own a copy of this exercise, then repoint their rows
          for (const [otherUid, refs] of otherUserMap.entries()) {
            let targetExerciseId: string | null = null;

            const { data: existingEx } = await adminClient
              .from('exercises')
              .select('id')
              .eq('user_id', otherUid)
              .eq('name', ex.name)
              .eq('is_archived', false)
              .maybeSingle();

            if (existingEx?.id) {
              targetExerciseId = existingEx.id;
            } else {
              const cloneId = crypto.randomUUID();
              const clonePayload: Record<string, any> = {
                id: cloneId,
                name: ex.name,
                user_id: otherUid,
                is_master: false,
                is_archived: ex.is_archived ?? false,
              };
              if (ex.equipment !== undefined) clonePayload.equipment = ex.equipment;
              if (ex.body_parts !== undefined) clonePayload.body_parts = ex.body_parts;

              const { error: insertErr } = await adminClient
                .from('exercises')
                .insert(clonePayload);

              if (!insertErr) {
                targetExerciseId = cloneId;
              } else {
                // If insert failed (e.g. unique constraint collision), resolve existing row
                const { data: fallbackEx } = await adminClient
                  .from('exercises')
                  .select('id')
                  .eq('user_id', otherUid)
                  .eq('name', ex.name)
                  .maybeSingle();
                targetExerciseId = fallbackEx?.id || null;
              }
            }

            if (targetExerciseId) {
              if (refs.teIds.length > 0) {
                await adminClient
                  .from('template_exercises')
                  .update({ exercise_id: targetExerciseId })
                  .in('id', refs.teIds);
              }
              if (refs.setIds.length > 0) {
                await adminClient
                  .from('sets')
                  .update({ exercise_id: targetExerciseId })
                  .in('id', refs.setIds);
              }
            }
          }

          // Now safely delete the caller's custom exercise
          await adminClient
            .from('exercises')
            .delete()
            .eq('id', ex.id);
        }
      }

      // 7. Delete auth user (cascades remaining user-owned rows: users, nutrition_logs, custom_dishes, coach links, etc.)
      const { error: deleteUserErr } = await adminClient.auth.admin.deleteUser(user.id);
      if (deleteUserErr) {
        throw deleteUserErr;
      }

      return new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch {
      // Never log email or user identifiers
      return new Response(
        JSON.stringify({ error: 'Account deletion failed', code: 'delete_failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  },
};
