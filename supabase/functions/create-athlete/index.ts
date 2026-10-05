import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isAllowedOrigin, getCorsHeaders } from "../_shared/cors.ts";

export { isAllowedOrigin, getCorsHeaders };

export default {
  async fetch(req: Request) {
    const origin = req.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);

    if (origin && !isAllowedOrigin(origin)) {
      return new Response(
        JSON.stringify({ error: 'CORS origin not allowed' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Authorization header. Authentication required.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

      if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Supabase environment variables not configured');
      }

      // Verify caller authentication
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized: Invalid token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify caller is a coach
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      const { data: callerProfile, error: profileErr } = await adminClient
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profileErr || callerProfile?.role !== 'coach') {
        return new Response(
          JSON.stringify({ error: 'Forbidden: Only coaches can provision athletes' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const body = await req.json().catch(() => ({}));
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim() : '';

      if (!name) {
        return new Response(
          JSON.stringify({ error: 'Athlete name is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const athleteEmail = email || `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@example.com`;
      const tempPassword = typeof body.password === 'string' && body.password.length >= 6
        ? body.password
        : 'password123';

      const { data: newAuthData, error: createError } = await adminClient.auth.admin.createUser({
        email: athleteEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          username: name,
        },
        app_metadata: {
          role: 'athlete',
        },
      });

      if (createError) {
        return new Response(
          JSON.stringify({ error: createError.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const newUserId = newAuthData.user.id;

      return new Response(
        JSON.stringify({
          success: true,
          athlete: {
            id: newUserId,
            name,
            email: athleteEmail,
            status: 'Active',
            last_active: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error('[create-athlete error]:', error.message);
      return new Response(
        JSON.stringify({ error: 'Failed to create athlete: ' + error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }
};
