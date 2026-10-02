// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: any;

export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-coordinator-token',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
  };
}

export function handleError(error: unknown, corsHeaders: Record<string, string>) {
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (error instanceof HttpError) {
    return new Response(
      JSON.stringify({
        success: false,
        code: error.code,
        message: error.message,
        error: {
          code: error.code,
          message: error.message,
        },
      }),
      { status: error.statusCode, headers }
    );
  }

  console.error("Server Error:", error);
  return new Response(
    JSON.stringify({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: (error as any)?.message || "An unexpected error occurred.",
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: (error as any)?.message || "An unexpected error occurred.",
      },
    }),
    { status: 500, headers }
  );
}

export const ADMIN_ALLOWLIST: readonly string[] = Object.freeze([
  'prasanthv865@gmail.com',
  'hruthvikmanoj4608@gmail.com',
  'saideepak4408@gmail.com',
  'nerellabhavanilakshmi@gmail.com',
  'principal@kitsakshar.ac.in',
  'qa.admin@kitsakshar.ac.in',
  'jnvsravankumar@gmail.com',
]);

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      status: 200, 
      headers: corsHeaders 
    });
  }

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new HttpError(500, 'CONFIGURATION_ERROR', 'Supabase environment configuration missing.');
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 1. Authenticate caller and strictly enforce ADMIN role + ALLOWLIST
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }

    const { data: { user: authUser }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !authUser || !authUser.email) {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }

    // Fetch caller's application role and status from public.users
    const { data: callerUser, error: callerDbErr } = await supabaseClient
      .from('users')
      .select('id, email, role, status')
      .eq('id', authUser.id)
      .single();

    if (callerDbErr || !callerUser) {
      throw new HttpError(401, "UNAUTHENTICATED", "Caller account record not found.");
    }

    if (callerUser.status !== 'ACTIVE') {
      throw new HttpError(403, "FORBIDDEN", "Account is deactivated or suspended.");
    }

    if (callerUser.role !== 'ADMIN') {
      throw new HttpError(403, 'FORBIDDEN', 'Administrative privileges required.');
    }

    const normalizedCallerEmail = (callerUser.email || '').trim().toLowerCase();
    if (!ADMIN_ALLOWLIST.includes(normalizedCallerEmail)) {
      throw new HttpError(403, "FORBIDDEN", "Unauthorized administrator identity.");
    }

    const identity = {
      userId: authUser.id,
      email: callerUser.email,
      role: callerUser.role,
    };

    // 2. Session ID Extraction for Idempotency
    let sessionId = "unknown-session";
    try {
      const payloadBase64Url = token.split('.')[1];
      const payloadBase64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/');
      const pad = payloadBase64.length % 4;
      const paddedPayload = pad ? payloadBase64 + '='.repeat(4 - pad) : payloadBase64;
      const payload = JSON.parse(atob(paddedPayload));
      
      if (payload.session_id) {
        sessionId = payload.session_id;
      }
    } catch {
      // Graceful fallback
    }

    // 3. Pre-check idempotency by session_id
    if (sessionId && sessionId !== "unknown-session") {
      const { data: existingLogs } = await supabaseClient
        .from('audit_logs')
        .select('id')
        .eq('action', 'ADMIN_LOGIN_SECURITY_EMAIL')
        .filter('metadata->>session_id', 'eq', sessionId)
        .limit(1);

      if (existingLogs && existingLogs.length > 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'Already notified for this session.' }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      }
    }

    // 4. Record audit log entry
    const { error: auditError } = await supabaseClient
      .from('audit_logs')
      .insert({
        actor_id: identity.userId,
        action: 'ADMIN_LOGIN_SECURITY_EMAIL',
        entity_type: 'auth.user',
        entity_id: identity.userId,
        metadata: {
          session_id: sessionId,
          email: identity.email,
          userAgent: req.headers.get('user-agent') || 'Unknown',
          ip: req.headers.get('x-forwarded-for') || 'Unknown',
          timestamp: new Date().toISOString(),
        }
      });

    if (auditError) {
      console.warn("Audit log notice (non-fatal):", auditError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Admin login notification recorded.' 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
