import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "../_shared/auth.ts";
import { HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { processStorageCleanupQueue } from "../_shared/assetLifecycle.ts";

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

    const supabaseClient = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
      { auth: { persistSession: false } }
    );

    // Ensure vault has service role key for autonomous pg_cron worker
    if (supabaseServiceRoleKey) {
      try {
        await supabaseClient.rpc('sync_service_role_key_to_vault', { p_key: supabaseServiceRoleKey });
      } catch (vaultErr) {
        console.warn('[admin-process-storage-cleanup] Vault sync warning:', vaultErr);
      }
    }

    // Verify admin identity or service role
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (token !== supabaseServiceRoleKey) {
      await requireRole(req, 'ADMIN', supabaseClient);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is acceptable
    }

    const batchSize = Math.min(Math.max(Number(body?.batch_size) || 20, 1), 50);

    // Process queued storage cleanups
    const queueResult = await processStorageCleanupQueue(supabaseClient, batchSize);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${queueResult.processed} queued storage cleanup job(s).`,
        processed: queueResult.processed,
        succeeded: queueResult.succeeded,
        failed: queueResult.failed,
        jobs: queueResult.jobs
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    if (error instanceof HttpError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message
        }),
        { status: error.statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.error('[admin-process-storage-cleanup] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'An unexpected error occurred during storage queue processing.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
