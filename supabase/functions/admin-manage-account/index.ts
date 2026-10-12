// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hashPassword } from "../_shared/password.ts";

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
        code: error.code,
        message: error.message,
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

  // 2. TEMPORARY FALLBACK (Phase 5B Controlled Migration Only):
  // Retained temporarily to prevent an outage if modern secret resolution fails.
  // Location: resolvePrivilegedKey() fallback branch in admin-manage-account/index.ts.
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

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      resolution.key,
      { auth: { persistSession: false } }
    );

    // 1. Authenticate and enforce ADMIN role
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }
    const { data: appUser, error: dbError } = await supabaseClient
      .from("users")
      .select("role, status, email")
      .eq("id", user.id)
      .single();
    if (dbError || !appUser || appUser.role !== 'ADMIN' || appUser.status !== 'ACTIVE') {
      throw new HttpError(403, 'FORBIDDEN', 'Administrative privileges required for account management operations.');
    }
    const identity = { userId: user.id, role: appUser.role, status: appUser.status, email: appUser.email };

    // 2. Parse payload
    let body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
    }

    const { action } = body;

    switch (action) {
      case 'reset_student_password': {
        const { user_id, new_password } = body;
        if (!user_id || typeof user_id !== 'string') {
          throw new HttpError(400, 'VALIDATION_ERROR', 'Target student user_id is required');
        }
        if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
          throw new HttpError(400, 'VALIDATION_ERROR', 'New password must be at least 6 characters long');
        }

        // Verify target student exists
        const { data: targetUser, error: fetchErr } = await supabaseClient
          .from('users')
          .select('id, email, role')
          .eq('id', user_id)
          .single();

        if (fetchErr || !targetUser) {
          throw new HttpError(404, 'NOT_FOUND', 'Target student user not found');
        }

        // Update password in auth.users via Supabase Admin API
        const { error: updateErr } = await supabaseClient.auth.admin.updateUserById(user_id, {
          password: new_password,
        });

        if (updateErr) {
          console.error('Password reset error:', updateErr);
          throw new HttpError(500, 'AUTH_ERROR', 'Failed to update student password.');
        }

        // Audit Log (Never log passwords)
        await supabaseClient.from('audit_logs').insert({
          actor_id: identity.userId,
          action: 'RESET_STUDENT_PASSWORD',
          entity_type: 'STUDENT_USER',
          entity_id: user_id,
          metadata: {
            target_email: targetUser.email,
            performed_by: identity.email,
          },
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: `Password successfully reset for student ${targetUser.email}`,
            usedModernKey: isModern,
            source: resolution.source === 'SUPABASE_SECRET_KEYS' ? 'SUPABASE_SECRET_KEYS' : 'SUPABASE_SERVICE_ROLE_KEY',
            legacyFallbackUsed: !isModern,
          }),
          { status: 200, headers: modernResponseHeaders }
        );
      }

      case 'delete_student_account': {
        const { user_id } = body;
        if (!user_id || typeof user_id !== 'string') {
          throw new HttpError(400, 'VALIDATION_ERROR', 'Target student user_id is required');
        }

        if (user_id === identity.userId) {
          throw new HttpError(400, 'OPERATION_DENIED', 'Cannot delete your own active administrator account');
        }

        const { data: targetUser, error: fetchErr } = await supabaseClient
          .from('users')
          .select('id, email, role')
          .eq('id', user_id)
          .single();

        if (fetchErr || !targetUser) {
          throw new HttpError(404, 'NOT_FOUND', 'Target student user not found');
        }

        const { data: profile } = await supabaseClient
          .from('student_profiles')
          .select('roll_number, full_name')
          .eq('user_id', user_id)
          .maybeSingle();

        await supabaseClient.from('feedback').delete().eq('user_id', user_id);
        await supabaseClient.from('complaints').delete().eq('user_id', user_id);

        const { data: leadRegistrations } = await supabaseClient
          .from('registrations')
          .select('id')
          .eq('leader_id', user_id);

        if (leadRegistrations && leadRegistrations.length > 0) {
          const regIds = leadRegistrations.map((r: { id: string }) => r.id);
          await supabaseClient.from('payments').delete().in('registration_id', regIds);

          const { data: teams } = await supabaseClient
            .from('teams')
            .select('id')
            .in('registration_id', regIds);

          if (teams && teams.length > 0) {
            const teamIds = teams.map((t: { id: string }) => t.id);
            await supabaseClient.from('attendance').delete().in('team_id', teamIds);
            await supabaseClient.from('team_members').delete().in('team_id', teamIds);
            await supabaseClient.from('teams').delete().in('id', teamIds);
          }

          await supabaseClient.from('registrations').delete().in('id', regIds);
        }

        await supabaseClient.from('team_members').delete().eq('user_id', user_id);
        await supabaseClient.from('student_profiles').delete().eq('user_id', user_id);
        await supabaseClient.from('users').delete().eq('id', user_id);

        const { error: authDelErr } = await supabaseClient.auth.admin.deleteUser(user_id);
        if (authDelErr) {
          console.error('Error deleting auth.users row:', authDelErr);
        }

        await supabaseClient.from('audit_logs').insert({
          actor_id: identity.userId,
          action: 'DELETE_STUDENT_ACCOUNT',
          entity_type: 'STUDENT_USER',
          entity_id: user_id,
          metadata: {
            deleted_email: targetUser.email,
            deleted_roll_number: profile?.roll_number || null,
            deleted_name: profile?.full_name || null,
            performed_by: identity.email,
          },
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: `Student account ${targetUser.email} has been permanently deleted.`,
            usedModernKey: isModern,
            source: resolution.source === 'SUPABASE_SECRET_KEYS' ? 'SUPABASE_SECRET_KEYS' : 'SUPABASE_SERVICE_ROLE_KEY',
            legacyFallbackUsed: !isModern,
          }),
          { status: 200, headers: modernResponseHeaders }
        );
      }

      case 'reset_coordinator_password': {
        const { coordinator_id, new_password } = body;
        if (!coordinator_id || typeof coordinator_id !== 'string') {
          throw new HttpError(400, 'VALIDATION_ERROR', 'Coordinator ID is required');
        }
        if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
          throw new HttpError(400, 'VALIDATION_ERROR', 'New password must be at least 6 characters long');
        }

        const { data: coord, error: coordFetchErr } = await supabaseClient
          .from('coordinators')
          .select('id, username, display_name')
          .eq('id', coordinator_id)
          .single();

        if (coordFetchErr || !coord) {
          throw new HttpError(404, 'NOT_FOUND', 'Coordinator record not found');
        }

        const computedHash = await hashPassword(new_password.trim());

        const { error: updateCoordErr } = await supabaseClient
          .from('coordinators')
          .update({ password_hash: computedHash })
          .eq('id', coordinator_id);

        if (updateCoordErr) {
          throw new HttpError(500, 'DATABASE_ERROR', 'Failed to update coordinator password');
        }

        await supabaseClient
          .from('coordinator_sessions')
          .delete()
          .eq('coordinator_id', coordinator_id);

        await supabaseClient.from('audit_logs').insert({
          actor_id: identity.userId,
          action: 'RESET_COORDINATOR_PASSWORD',
          entity_type: 'COORDINATOR',
          entity_id: coordinator_id,
          metadata: {
            coordinator_username: coord.username,
            coordinator_name: coord.display_name,
            performed_by: identity.email,
          },
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: `Password successfully updated for coordinator "${coord.display_name}" (${coord.username})`,
            usedModernKey: isModern,
            source: resolution.source === 'SUPABASE_SECRET_KEYS' ? 'SUPABASE_SECRET_KEYS' : 'SUPABASE_SERVICE_ROLE_KEY',
            legacyFallbackUsed: !isModern,
          }),
          { status: 200, headers: modernResponseHeaders }
        );
      }

      case 'delete_coordinator': {
        const { coordinator_id } = body;
        if (!coordinator_id || typeof coordinator_id !== 'string') {
          throw new HttpError(400, 'VALIDATION_ERROR', 'Coordinator ID is required');
        }

        const { data: coord, error: coordFetchErr } = await supabaseClient
          .from('coordinators')
          .select('id, username, display_name')
          .eq('id', coordinator_id)
          .single();

        if (coordFetchErr || !coord) {
          throw new HttpError(404, 'NOT_FOUND', 'Coordinator record not found');
        }

        await supabaseClient
          .from('coordinator_assignments')
          .delete()
          .eq('coordinator_id', coordinator_id);

        const { error: delCoordErr } = await supabaseClient
          .from('coordinators')
          .delete()
          .eq('id', coordinator_id);

        if (delCoordErr) {
          throw new HttpError(500, 'DATABASE_ERROR', 'Failed to delete coordinator');
        }

        await supabaseClient.from('audit_logs').insert({
          actor_id: identity.userId,
          action: 'DELETE_COORDINATOR',
          entity_type: 'COORDINATOR',
          entity_id: coordinator_id,
          metadata: {
            deleted_username: coord.username,
            deleted_name: coord.display_name,
            performed_by: identity.email,
          },
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: `Coordinator "${coord.display_name}" and associated assignments have been permanently deleted.`,
            usedModernKey: isModern,
            source: resolution.source === 'SUPABASE_SECRET_KEYS' ? 'SUPABASE_SECRET_KEYS' : 'SUPABASE_SERVICE_ROLE_KEY',
            legacyFallbackUsed: !isModern,
          }),
          { status: 200, headers: modernResponseHeaders }
        );
      }

      default:
        throw new HttpError(400, 'INVALID_ACTION', `Action "${action}" is not recognized.`);
    }
  } catch (error) {
    return handleError(error, corsHeaders, modernResponseHeaders);
  }
});
