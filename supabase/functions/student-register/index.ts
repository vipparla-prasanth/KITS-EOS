// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: any;

class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  const defaultOrigins = 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5177,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5177';
  const allowedOriginsEnv = Deno.env.get('ALLOWED_ORIGINS') || defaultOrigins;
  const allowedOrigins = allowedOriginsEnv.split(',').map((o: string) => o.trim());
  
  let allowOrigin = origin || '*';
  if (origin && (allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
    allowOrigin = origin;
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // 1. Authoritative Identity Forwarding via Student Bearer Token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Missing authorization header');
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Invalid bearer token');
    }

    // 2. Parse & Validate Payload Envelope
    let body: any;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
    }

    const {
      sub_event_id,
      mode = 'SOLO',
      team_name = null,
      team_members = [],
      uploaded_documents = [],
      payment_method = 'UPI',
      payment_reference = null,
    } = body;

    if (!sub_event_id || typeof sub_event_id !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'sub_event_id is required');
    }

    if (!['SOLO', 'TEAM'].includes(mode)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'mode must be SOLO or TEAM');
    }

    if (!Array.isArray(team_members) || team_members.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'At least one participant is required');
    }

    if (mode === 'TEAM') {
      if (team_members.length < 2) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Team registration requires at least 2 members');
      }
      if (!team_name || typeof team_name !== 'string' || !team_name.trim()) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Team name is required for team participation');
      }
      for (let i = 1; i < team_members.length; i++) {
        const m = team_members[i];
        const name = (m?.snapshot_name || m?.name || '').trim();
        const roll = (m?.snapshot_roll_number || m?.roll_number || '').trim();
        const dept = (m?.snapshot_department || m?.department || '').trim();
        const college = (m?.snapshot_college || m?.college || '').trim();
        if (!name) {
          throw new HttpError(400, 'INVALID_TEAM_MEMBER_NAME', 'All team members must have a valid full name.');
        }
        if (!roll) {
          throw new HttpError(400, 'INVALID_TEAM_MEMBER_ROLL', 'All team members must have a valid, non-empty roll number.');
        }
        if (!dept) {
          throw new HttpError(400, 'INVALID_TEAM_MEMBER_DEPARTMENT', 'All team members must specify a valid department or branch.');
        }
        if (college.length < 2) {
          throw new HttpError(400, 'INVALID_TEAM_MEMBER_COLLEGE', 'All team members must specify a valid college or institution.');
        }
      }
    }

    // 3. Forward Student JWT to PostgreSQL User-Context Client
    // This allows PostgreSQL to cryptographically resolve auth.uid() natively
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const userClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
        auth: { persistSession: false },
      }
    );

    // 4. Execute Atomic Single-Transaction Registration RPC
    const { data: rpcResult, error: rpcError } = await userClient.rpc('student_register_atomic', {
      p_sub_event_id: sub_event_id,
      p_mode: mode,
      p_team_name: team_name,
      p_team_members: team_members,
      p_uploaded_documents: uploaded_documents,
      p_payment_method: payment_method,
      p_payment_reference: payment_reference,
    });

    if (rpcError) {
      const errText = rpcError.message || '';
      if (errText.includes('Authentication required') || errText.includes('JWT')) {
        throw new HttpError(401, 'UNAUTHORIZED', 'Invalid or expired session');
      }
      if (errText.includes('Account is inactive') || errText.includes('suspended')) {
        throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'Your account is currently inactive or suspended');
      }
      if (errText.includes('permission denied') || errText.includes('violates row-level')) {
        throw new HttpError(403, 'FORBIDDEN', 'Permission denied');
      }
      console.error('Registration RPC database error:', rpcError);
      const isTechnicalError = errText.includes('enum') || errText.includes('relation') || errText.includes('syntax') || errText.includes('table');
      const safeMessage = isTechnicalError 
        ? 'A database processing error occurred while recording your registration. Please try again or contact event operations.'
        : (errText || 'Registration transaction failed');
      throw new HttpError(500, 'DATABASE_ERROR', safeMessage);
    }

    if (!rpcResult || rpcResult.success === false) {
      const code = rpcResult?.code || 'REGISTRATION_FAILED';
      const message = rpcResult?.message || 'Registration could not be completed';
      let statusCode = 400;

      if (code === 'ALREADY_REGISTERED' || code === 'MEMBER_ALREADY_REGISTERED' || code === 'CAPACITY_REACHED') {
        statusCode = 409;
      } else if (code === 'NOT_FOUND') {
        statusCode = 404;
      } else if (code === 'ACCOUNT_SUSPENDED') {
        statusCode = 403;
      } else if (code === 'UNAUTHORIZED') {
        statusCode = 401;
      }

      throw new HttpError(statusCode, code, message);
    }

    // 5. Build Authoritative Response Preserving Exact JSON Contracts
    // (Both flat properties and nested registration object for complete compatibility)
    const authoritativeRegStatus = rpcResult.status || rpcResult.registration_status || (rpcResult.payment?.status === 'SUCCESS' || rpcResult.is_free ? 'CONFIRMED' : 'PENDING_PAYMENT');
    const responsePayload = {
      success: true,
      registration_id: rpcResult.registration_id,
      team_id: rpcResult.team_id,
      members_count: rpcResult.members_count,
      status: authoritativeRegStatus,
      registration_status: authoritativeRegStatus,
      is_free: Boolean(rpcResult.is_free),
      payment: rpcResult.payment,
      members: rpcResult.members,
      registration: {
        id: rpcResult.registration_id,
        status: authoritativeRegStatus,
        created_at: new Date().toISOString(),
        payment: rpcResult.payment,
        team: {
          id: rpcResult.team_id,
          team_name: mode === 'TEAM' ? (team_name?.trim() || 'Team') : 'Solo Participant',
          members: rpcResult.members,
        },
      },
    };

    return new Response(
      JSON.stringify(responsePayload),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
