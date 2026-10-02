import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "../_shared/auth.ts";
import { HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight
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

    // 1. Authoritative Identity & Admin Role Verification
    // Extracts Bearer JWT, validates with auth.getUser(), verifies role='ADMIN' & status='ACTIVE' in public.users,
    // and strictly enforces ADMIN_ALLOWLIST.
    const identity = await requireRole(req, 'ADMIN', supabaseClient);

    // 2. Parse & Validate Payload
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid JSON request body.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rawIds = body?.notification_ids ?? body?.ids;

    // Edge Case: Empty or missing notification selection
    if (!rawIds || !Array.isArray(rawIds) || rawIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No notification IDs provided for deletion.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Edge Case: Validate UUID format for each identifier
    for (const id of rawIds) {
      if (typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Invalid notification UUID format: ${String(id)}`
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Edge Case: Handle duplicate IDs
    const cleanIds: string[] = Array.from(new Set(rawIds.map((id: string) => id.trim())));

    // 3. Invoke Canonical Database RPC (Admin Delete Notifications)
    const { data: rpcResult, error: rpcError } = await supabaseClient.rpc(
      'admin_delete_notifications',
      {
        p_notification_ids: cleanIds,
        p_actor_id: identity.userId
      }
    );

    if (rpcError) {
      const isValidationError = rpcError.code === '22023';
      const isAuthError = rpcError.code === '42501';
      const statusCode = isValidationError ? 400 : isAuthError ? 403 : 500;

      return new Response(
        JSON.stringify({
          success: false,
          error: rpcError.message || 'Failed to delete notifications.'
        }),
        { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Return Structured Success Response
    const deletedCount = Number(rpcResult?.deleted_count ?? 0);
    return new Response(
      JSON.stringify({
        success: true,
        deleted_count: deletedCount,
        deleted_ids: rpcResult?.deleted_ids ?? [],
        message: rpcResult?.message ?? `${deletedCount} notification(s) permanently deleted.`
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

    console.error('admin-delete-notifications unexpected server error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'An unexpected error occurred during notification deletion.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
