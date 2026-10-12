import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "../_shared/auth.ts";
import { HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { processStorageCleanupQueue } from "../_shared/assetLifecycle.ts";

declare const Deno: any;

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

  // 2. TEMPORARY FALLBACK (Phase 5E Controlled Migration Only):
  // Retained temporarily to prevent an outage if modern secret resolution fails.
  // Location: resolvePrivilegedKey() fallback branch in admin-process-storage-cleanup/index.ts.
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

  const resolution = resolvePrivilegedKey();
  const isModern = resolution.isModern;
  const fallbackKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  const modernResponseHeaders = {
    ...corsHeaders,
    'x-secret-resolution': isModern ? 'SUCCESS' : 'TEMPORARY_FALLBACK',
    'x-used-modern-key': isModern ? 'true' : 'false',
    'x-key-source': resolution.source,
  };

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed. Only POST requests are permitted.');
    }

    if (!resolution.key) {
      throw new HttpError(500, 'CONFIGURATION_ERROR', 'Server configuration error: missing privileged credentials.');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';

    const supabaseClient = createClient(
      supabaseUrl,
      resolution.key,
      { auth: { persistSession: false } }
    );

    // Sync privileged key to vault for autonomous pg_cron worker
    if (resolution.key) {
      try {
        await supabaseClient.rpc('sync_service_role_key_to_vault', { p_key: resolution.key });
      } catch (vaultErr) {
        console.warn('[admin-process-storage-cleanup] Vault sync warning:', vaultErr);
      }
    }

    // Verify caller: autonomous worker with privileged key from vault OR authenticated ADMIN
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    const isServiceCall = (Boolean(resolution.key) && token === resolution.key) ||
                          (Boolean(fallbackKey) && token === fallbackKey);

    if (!isServiceCall) {
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
        jobs: queueResult.jobs,
        usedModernKey: isModern,
        source: resolution.source === 'SUPABASE_SECRET_KEYS' ? 'SUPABASE_SECRET_KEYS' : 'SUPABASE_SERVICE_ROLE_KEY',
        legacyFallbackUsed: !isModern,
      }),
      { status: 200, headers: { ...modernResponseHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    if (error instanceof HttpError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message,
          usedModernKey: isModern,
          source: resolution.source === 'SUPABASE_SECRET_KEYS' ? 'SUPABASE_SECRET_KEYS' : 'SUPABASE_SERVICE_ROLE_KEY',
        }),
        { status: error.statusCode, headers: { ...modernResponseHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.error('[admin-process-storage-cleanup] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'An unexpected error occurred during storage queue processing.',
        usedModernKey: isModern,
        source: resolution.source === 'SUPABASE_SECRET_KEYS' ? 'SUPABASE_SECRET_KEYS' : 'SUPABASE_SERVICE_ROLE_KEY',
      }),
      { status: 500, headers: { ...modernResponseHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
