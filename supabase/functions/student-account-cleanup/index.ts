import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "../_shared/auth.ts";
import { HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed. Only POST requests are permitted.');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new HttpError(500, 'CONFIGURATION_ERROR', 'Server configuration missing.');
    }

    const supabaseClient = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
      { auth: { persistSession: false } }
    );

    // Verify caller: either autonomous worker with service role token, or authenticated ADMIN
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (token !== supabaseServiceRoleKey) {
      await requireRole(req, 'ADMIN', supabaseClient);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Body is optional
    }

    const batchSize = Math.min(Math.max(Number(body?.batch_size) || 50, 1), 100);

    // 1. Fetch expired deactivated student accounts
    const nowIso = new Date().toISOString();
    const { data: expiredUsers, error: fetchErr } = await supabaseClient
      .from('users')
      .select('id, email, deactivated_at, scheduled_permanent_deletion_at')
      .eq('status', 'DEACTIVATED')
      .not('scheduled_permanent_deletion_at', 'is', null)
      .lte('scheduled_permanent_deletion_at', nowIso)
      .limit(batchSize);

    if (fetchErr) {
      console.error('[student-account-cleanup] Error querying expired users:', fetchErr);
      throw new HttpError(500, 'DATABASE_ERROR', 'Failed to fetch expired student accounts.');
    }

    const results: Array<{ id: string; email: string; success: boolean; error?: string }> = [];

    if (expiredUsers && expiredUsers.length > 0) {
      console.log(`[student-account-cleanup] Processing ${expiredUsers.length} expired deactivated accounts...`);

      for (const user of expiredUsers) {
        try {
          // A. Clean up personal data and unlink foreign keys via database RPC
          const { data: rpcRes, error: rpcErr } = await supabaseClient.rpc(
            'cleanup_expired_student_account_data',
            { p_user_id: user.id }
          );

          if (rpcErr) {
            console.error(`[student-account-cleanup] DB cleanup failed for user ${user.id}:`, rpcErr);
            results.push({ id: user.id, email: user.email, success: false, error: rpcErr.message });
            continue;
          }

          // B. Permanently delete Auth user via Supabase Admin API
          const { error: authDelErr } = await supabaseClient.auth.admin.deleteUser(user.id);
          if (authDelErr) {
            console.warn(`[student-account-cleanup] Auth delete warning for user ${user.id}:`, authDelErr);
          }

          results.push({ id: user.id, email: user.email, success: true });
        } catch (itemErr: any) {
          console.error(`[student-account-cleanup] Exception cleaning user ${user.id}:`, itemErr);
          results.push({ id: user.id, email: user.email, success: false, error: itemErr.message });
        }
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${results.length} expired student account(s).`,
        processed: results.length,
        succeeded,
        failed,
        results
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    if (error instanceof HttpError) {
      return new Response(
        JSON.stringify({
          success: false,
          code: error.code,
          error: error.message
        }),
        { status: error.statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.error('[student-account-cleanup] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'An unexpected error occurred during student account cleanup.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
