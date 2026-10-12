// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "../_shared/auth.ts";
import { HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PrivilegedKeyResolution {
  key: string;
  source: 'SUPABASE_SECRET_KEYS' | 'SUPABASE_SERVICE_ROLE_KEY_FALLBACK' | 'NONE';
  isModern: boolean;
}

function resolvePrivilegedKey(): PrivilegedKeyResolution {
  // 1. Primary: Modern SUPABASE_SECRET_KEYS JSON dictionary ({ "default": "sb_secret_..." })
  const modernKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modernKeysRaw && typeof modernKeysRaw === 'string') {
    try {
      const parsed = JSON.parse(modernKeysRaw);
      let candidate = '';
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.default === 'string' && parsed.default.trim().length > 0) {
          candidate = parsed.default.trim();
        } else {
          const candidateVal = Object.values(parsed).find(
            (v): v is string => typeof v === 'string' && v.trim().startsWith('sb_secret_')
          );
          if (candidateVal) {
            candidate = candidateVal.trim();
          }
        }
      } else if (typeof parsed === 'string' && parsed.trim().length > 0) {
        candidate = parsed.trim();
      }

      if (candidate) {
        return {
          key: candidate,
          source: 'SUPABASE_SECRET_KEYS',
          isModern: true,
        };
      }
    } catch {
      // JSON parse error handling: fall through to temporary fallback
    }
  }

  // 2. TEMPORARY FALLBACK (Phase 4D Controlled Migration Only):
  // Retained temporarily to prevent an outage if modern secret resolution fails.
  // Location: resolvePrivilegedKey() fallback branch in admin-delete-notifications/index.ts.
  // Warning: Must NOT become permanent architecture; will be removed once modern secret resolution is verified.
  const fallbackKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (fallbackKey && typeof fallbackKey === 'string' && fallbackKey.trim().length > 0) {
    return {
      key: fallbackKey.trim(),
      source: 'SUPABASE_SERVICE_ROLE_KEY_FALLBACK',
      isModern: false,
    };
  }

  return {
    key: '',
    source: 'NONE',
    isModern: false,
  };
}

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
    const resolution = resolvePrivilegedKey();
    const elevatedKey = resolution.key;
    const isModern = resolution.isModern;

    if (!supabaseUrl || !elevatedKey) {
      throw new HttpError(500, 'CONFIGURATION_ERROR', 'Supabase environment configuration missing.');
    }

    const supabaseClient = createClient(
      supabaseUrl,
      elevatedKey,
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
          error: isValidationError
            ? (rpcError.message || 'Invalid notification IDs provided.')
            : isAuthError
            ? 'Unauthorized.'
            : (rpcError.message || 'Failed to delete notifications.')
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
        message: rpcResult?.message ?? `${deletedCount} notification(s) permanently deleted.`,
        secret_resolution: isModern ? 'SUCCESS' : 'TEMPORARY_FALLBACK',
        usedModernKey: isModern,
        source: resolution.source === 'SUPABASE_SECRET_KEYS' ? 'SUPABASE_SECRET_KEYS' : 'SUPABASE_SERVICE_ROLE_KEY',
        legacyFallbackUsed: !isModern
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
        error: 'An unexpected error occurred during notification deletion.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
