import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";

class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function handleError(error: unknown, corsHeaders: Record<string, string>) {
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (error instanceof HttpError) {
    return new Response(
      JSON.stringify({
        success: false,
        code: error.code,
        message: error.message,
        error: { code: error.code, message: error.message }
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

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    }

    let body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
    }

    const { sub_event_id, query } = body;
    
    if (!sub_event_id || typeof sub_event_id !== 'string') {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'sub_event_id is required'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!query || typeof query !== 'string' || !query.trim()) {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Token, QR identity, or Roll Number is required'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract coordinator session token from x-coordinator-token or Authorization
    let coordinatorToken: string | null = req.headers.get("x-coordinator-token");
    const authHeader = req.headers.get("Authorization");
    if (!coordinatorToken && authHeader) {
      const candidate = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (candidate.startsWith("ctk_")) {
        coordinatorToken = candidate;
      }
    }

    // Forward Authorization header if Admin JWT is provided
    const clientHeaders: Record<string, string> = {};
    if (authHeader && !coordinatorToken) {
      clientHeaders['Authorization'] = authHeader;
    }

function resolvePublishableKey(): string {
  const raw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (raw && typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.default === 'string' && parsed.default.trim().length > 0) {
          return parsed.default.trim();
        }
        const candidate = Object.values(parsed).find(
          (v): v is string => typeof v === 'string' && v.trim().startsWith('sb_publishable_')
        );
        if (candidate) return candidate.trim();
      } else if (typeof parsed === 'string' && parsed.trim().length > 0) {
        return parsed.trim();
      }
    } catch {}
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      resolvePublishableKey(),
      {
        auth: { persistSession: false },
        global: { headers: clientHeaders }
      }
    );

    // Call atomic verify_attendance_participant RPC in PostgreSQL
    const { data: result, error: rpcError } = await supabaseClient.rpc('verify_attendance_participant', {
      p_sub_event_id: sub_event_id,
      p_query: query.trim(),
      p_coordinator_token: coordinatorToken || null
    });

    if (rpcError) {
      console.error("verify_attendance_participant RPC error:", rpcError);
      return new Response(
        JSON.stringify({
          success: false,
          code: 'DATABASE_ERROR',
          message: 'Database error during attendance verification.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
