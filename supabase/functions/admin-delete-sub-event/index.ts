// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "../_shared/auth.ts";
import { HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { processStorageCleanupQueue } from "../_shared/assetLifecycle.ts";

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

  // 2. TEMPORARY FALLBACK (Phase 4C Controlled Migration Only):
  // Retained temporarily to prevent an outage if modern secret resolution fails.
  // Location: resolvePrivilegedKey() fallback branch in admin-delete-sub-event/index.ts.
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
    await requireRole(req, 'ADMIN', supabaseClient);

    // 2. Parse & Validate Payload
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON request body.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const subEventId = (body?.sub_event_id || body?.p_sub_event_id || body?.entity_id || '').toString().trim();
    const confirmationPhrase = (body?.confirmation_phrase || body?.p_confirmation_phrase || 'CONFIRM').toString().trim();

    if (!UUID_REGEX.test(subEventId)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid sub-event UUID format: "${subEventId}"` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Invoke Canonical Database RPC (admin_delete_historical_data with scope 'SUB_EVENT')
    const { data: rpcResult, error: rpcError } = await supabaseClient.rpc(
      'admin_delete_historical_data',
      {
        p_scope: 'SUB_EVENT',
        p_entity_id: subEventId,
        p_confirmation_phrase: confirmationPhrase
      }
    );

    if (rpcError) {
      console.error('[admin-delete-sub-event] RPC Error:', rpcError);
      const isValidationError = rpcError.code === '22023' || rpcError.message?.includes('mismatch') || rpcError.message?.includes('ACTIVE');
      const isAuthError = rpcError.code === '42501' || rpcError.message?.includes('privileges');
      const isNotFound = rpcError.message?.includes('not found');
      const statusCode = isValidationError ? 400 : isAuthError ? 403 : isNotFound ? 404 : 500;

      let safeError = 'Failed to delete sub-event.';
      if (isValidationError) {
        safeError = rpcError.message?.includes('mismatch') 
          ? 'Confirmation phrase does not match.' 
          : rpcError.message?.includes('ACTIVE') 
          ? 'Cannot delete active sub-event.' 
          : 'Invalid deletion request parameters.';
      } else if (isAuthError) {
        safeError = 'Insufficient administrative privileges.';
      } else if (isNotFound) {
        safeError = 'Sub-event not found.';
      }

      return new Response(
        JSON.stringify({ success: false, error: safeError }),
        { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Immediately Execute Backend Outbox Queue Processor
    const queueResult = await processStorageCleanupQueue(supabaseClient, 20);

    return new Response(
      JSON.stringify({
        success: true,
        already_deleted: Boolean(rpcResult?.already_deleted),
        message: rpcResult?.message ?? 'Sub-event deleted successfully.',
        sub_event_id: subEventId,
        entity_name: rpcResult?.entity_name,
        deleted_counts: rpcResult?.deleted_counts,
        storage_cleanup: {
          queued: rpcResult?.queued_cleanups ?? 0,
          processed: queueResult.processed,
          succeeded: queueResult.succeeded,
          failed: queueResult.failed
        },
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
        JSON.stringify({ success: false, error: error.message }),
        { status: error.statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.error('[admin-delete-sub-event] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An unexpected error occurred during sub-event deletion.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
