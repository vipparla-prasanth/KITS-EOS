import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";

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

  // 2. TEMPORARY FALLBACK (Phase 5C Controlled Migration Only):
  // Retained temporarily to prevent an outage if modern secret resolution fails.
  // Location: resolvePrivilegedKey() fallback branch in coordinator-confirm-payment/index.ts.
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

class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function handleError(error: unknown, corsHeaders: Record<string, string>, extraHeaders?: Record<string, string>) {
  const headers = { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" };
  if (error instanceof HttpError) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: error.code, message: error.message },
        ...(extraHeaders ? {
          usedModernKey: extraHeaders['x-used-modern-key'] === 'true',
          source: extraHeaders['x-key-source'],
        } : {})
      }),
      { status: error.statusCode, headers }
    );
  }
  console.error("Server Error:", error);
  return new Response(
    JSON.stringify({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." }
    }),
    { status: 500, headers }
  );
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const resolution = resolvePrivilegedKey();
  const isModern = resolution.isModern;
  const modernResponseHeaders = {
    ...corsHeaders,
    'x-secret-resolution': isModern ? 'SUCCESS' : 'TEMPORARY_FALLBACK',
    'x-used-modern-key': isModern ? 'true' : 'false',
    'x-key-source': resolution.source,
  };

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    }

    if (!resolution.key) {
      throw new HttpError(500, 'CONFIGURATION_ERROR', 'Server configuration error: missing privileged credentials.');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';

    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const supabaseClient = createClient(
      supabaseUrl,
      resolution.key,
      { auth: { persistSession: false } }
    );

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
    }

    const { payment_id, payment_ids } = body;
    let targetPaymentIds: string[] = [];

    if (Array.isArray(payment_ids) && payment_ids.length > 0) {
      targetPaymentIds = payment_ids.filter((id: any) => typeof id === 'string' && id.trim().length > 0);
    } else if (payment_id && typeof payment_id === 'string' && payment_id.trim().length > 0) {
      targetPaymentIds = [payment_id.trim()];
    }

    if (targetPaymentIds.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'payment_id or payment_ids array is required');
    }

    // 1. Verify coordinator, admin, or payment manager identity cryptographically from session token or JWT
    let isAuthorized = false;
    let effectiveCoordinatorId: string | null = null;
    let actorRole: 'COORDINATOR' | 'ADMIN' | 'PAYMENT_MANAGER' | null = null;
    let authUserId: string | null = null;

    let coordinatorToken: string | null = req.headers.get("x-coordinator-token");
    const authHeader = req.headers.get("Authorization");
    if (!coordinatorToken && authHeader) {
      const candidate = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (candidate.startsWith("ctk_")) {
        coordinatorToken = candidate;
      }
    }

    if (coordinatorToken) {
      const encoder = new TextEncoder();
      const data = encoder.encode(coordinatorToken.trim());
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const tokenHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const { data: sessionData, error: sessionErr } = await supabaseClient
        .from("coordinator_sessions")
        .select(`
          coordinator_id,
          expires_at,
          coordinators!inner (
            id,
            status
          )
        `)
        .eq("token_hash", tokenHash)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (!sessionErr && sessionData && (sessionData.coordinators as any)?.status === "ACTIVE") {
        effectiveCoordinatorId = sessionData.coordinator_id;
        actorRole = "COORDINATOR";
      }
    } else if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token && !token.startsWith("ctk_") && token !== supabaseAnonKey) {
        const { data: { user } } = await supabaseClient.auth.getUser(token);
        if (user) {
          const { data: appUser } = await supabaseClient
            .from("users")
            .select("role, status")
            .eq("id", user.id)
            .single();

          if (appUser && (appUser.role === "ADMIN" || appUser.role === "PAYMENT_MANAGER") && appUser.status === "ACTIVE") {
            isAuthorized = true;
            actorRole = appUser.role;
            authUserId = user.id;
          }
        }
      }
    }

    if (!isAuthorized && !effectiveCoordinatorId) {
      throw new HttpError(403, 'FORBIDDEN', 'Coordinator or Payment Manager authentication required.');
    }

    // 2. Execute confirmation via authoritative confirm_bulk_payments RPC
    let rpcCaller = supabaseClient;
    if (authUserId && authHeader) {
      // If admin with Supabase Auth token, create user-scoped client so auth.uid() resolves
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      rpcCaller = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      });
    }

    const { data: rpcData, error: rpcErr } = await rpcCaller.rpc('confirm_bulk_payments', {
      p_payment_ids: targetPaymentIds,
      p_token: coordinatorToken,
    });

    if (rpcErr) {
      console.error("confirm_bulk_payments RPC error:", rpcErr);
      if (rpcErr.code === '42501' || rpcErr.message?.includes('Unauthorized') || rpcErr.message?.includes('Forbidden')) {
        throw new HttpError(403, 'FORBIDDEN', 'Unauthorized to confirm payment.');
      }
      if (rpcErr.code === 'P0002' || rpcErr.message?.includes('not found') || rpcErr.message?.includes('do not exist')) {
        throw new HttpError(404, 'NOT_FOUND', 'Payment record not found.');
      }
      throw new HttpError(500, 'DATABASE_ERROR', 'Payment approval failed.');
    }

    return new Response(JSON.stringify(rpcData || {
      success: true,
      message: `${targetPaymentIds.length} payment(s) marked as PAID successfully.`,
      payment_ids: targetPaymentIds,
      status: 'SUCCESS',
      usedModernKey: isModern,
      source: resolution.source === 'SUPABASE_SECRET_KEYS' ? 'SUPABASE_SECRET_KEYS' : 'SUPABASE_SERVICE_ROLE_KEY',
      legacyFallbackUsed: !isModern,
    }), {
      headers: modernResponseHeaders,
      status: 200,
    });

  } catch (error) {
    return handleError(error, corsHeaders, modernResponseHeaders);
  }
});
