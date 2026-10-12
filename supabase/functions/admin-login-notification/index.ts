// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
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
      message: "An unexpected error occurred.",
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
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

  // 2. TEMPORARY FALLBACK (Phase 3 Controlled Migration Only):
  // Retained temporarily to prevent an outage if modern secret resolution fails.
  // Location: resolvePrivilegedKey() fallback branch in admin-login-notification/index.ts.
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
    const { key: elevatedKey, isModern } = resolvePrivilegedKey();

    if (!supabaseUrl || !elevatedKey) {
      throw new HttpError(500, 'CONFIGURATION_ERROR', 'Supabase environment configuration missing.');
    }

    const supabaseClient = createClient(supabaseUrl, elevatedKey, {
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
          JSON.stringify({ 
            success: true, 
            message: 'Already notified for this session.',
            secret_resolution: isModern ? 'SUCCESS' : 'TEMPORARY_FALLBACK',
          }),
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
        message: 'Admin login notification recorded.',
        secret_resolution: isModern ? 'SUCCESS' : 'TEMPORARY_FALLBACK',
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
