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

    let body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
    }

    const { sub_event_id, team_id, scanned_member_id, scanned_member_ids, token_or_qr } = body;
    
    if (!sub_event_id || typeof sub_event_id !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'sub_event_id is required');
    }

    // Extract coordinator session token
    let coordinatorToken: string | null = req.headers.get("x-coordinator-token");
    const authHeader = req.headers.get("Authorization");
    if (!coordinatorToken && authHeader) {
      const candidate = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (candidate.startsWith("ctk_")) {
        coordinatorToken = candidate;
      }
    }

    const clientHeaders: Record<string, string> = {};
    if (authHeader && !coordinatorToken) {
      clientHeaders['Authorization'] = authHeader;
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: { persistSession: false },
        global: { headers: clientHeaders }
      }
    );

    let effectiveTeamId = team_id;
    let memberIds: string[] = [];

    if (Array.isArray(scanned_member_ids) && scanned_member_ids.length > 0) {
      memberIds = scanned_member_ids;
    } else if (scanned_member_id) {
      memberIds = [scanned_member_id];
    }

    // If team_id or members were not provided directly, resolve first via verify RPC
    if ((!effectiveTeamId || memberIds.length === 0) && token_or_qr) {
      const { data: verifyResult, error: vErr } = await supabaseClient.rpc('verify_attendance_participant', {
        p_sub_event_id: sub_event_id,
        p_query: token_or_qr.trim(),
        p_coordinator_token: coordinatorToken || null
      });

      if (vErr || !verifyResult?.success) {
        throw new HttpError(400, verifyResult?.code || 'VERIFICATION_FAILED', verifyResult?.message || 'Participant resolution failed.');
      }

      effectiveTeamId = verifyResult.team?.id;
      memberIds = [verifyResult.participant?.id];
    }

    if (!effectiveTeamId || memberIds.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'team_id and at least one member are required for attendance check-in');
    }

    // Call atomic commit_attendance_checkin RPC in PostgreSQL
    const { data: checkinResult, error: rpcError } = await supabaseClient.rpc('commit_attendance_checkin', {
      p_sub_event_id: sub_event_id,
      p_team_id: effectiveTeamId,
      p_scanned_member_ids: memberIds,
      p_coordinator_token: coordinatorToken || null
    });

    if (rpcError) {
      console.error("commit_attendance_checkin RPC error:", rpcError);
      throw new HttpError(400, 'CHECKIN_FAILED', rpcError.message || 'Failed to commit attendance check-in');
    }

    return new Response(
      JSON.stringify(checkinResult),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
