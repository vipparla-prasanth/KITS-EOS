import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-coordinator-token',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
  };
}

function handleError(error: unknown, corsHeaders: Record<string, string>) {
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (error instanceof HttpError) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: error.code, message: error.message }
      }),
      { status: error.statusCode, headers }
    );
  }
  console.error("Server Error:", error);
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: (error as any)?.message || "An unexpected error occurred." }
    }),
    { status: 500, headers }
  );
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const supabaseClient = createClient(
      supabaseUrl,
      supabaseServiceKey,
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
      const msg = rpcErr.message || 'Payment approval failed';
      if (rpcErr.code === '42501' || msg.includes('Unauthorized') || msg.includes('Forbidden')) {
        throw new HttpError(403, 'FORBIDDEN', msg);
      }
      if (rpcErr.code === 'P0002' || msg.includes('not found') || msg.includes('do not exist')) {
        throw new HttpError(404, 'NOT_FOUND', msg);
      }
      throw new HttpError(500, 'DATABASE_ERROR', msg);
    }

    return new Response(JSON.stringify(rpcData || {
      success: true,
      message: `${targetPaymentIds.length} payment(s) marked as PAID successfully.`,
      payment_ids: targetPaymentIds,
      status: 'SUCCESS',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
