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

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  // 1. Explicitly handle browser OPTIONS preflight
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

    // 2. Authenticate caller and strictly enforce ADMIN role + ALLOWLIST
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }

    // Verify caller JWT
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
      throw new HttpError(403, 'FORBIDDEN', 'Administrative privileges required to reset credentials.');
    }

    const normalizedCallerEmail = (callerUser.email || '').trim().toLowerCase();
    if (!ADMIN_ALLOWLIST.includes(normalizedCallerEmail)) {
      throw new HttpError(403, "FORBIDDEN", "Unauthorized administrator identity.");
    }

    const callerIdentity = {
      userId: authUser.id,
      email: callerUser.email,
      role: callerUser.role,
    };

    // 3. Parse and validate request payload
    let body: any;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body in request.');
    }

    const targetUserId = body.targetUserId || body.user_id;
    const newPassword = body.newPassword || body.new_password;

    if (!targetUserId || typeof targetUserId !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Target user ID is required.');
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'New password must be at least 6 characters long.');
    }

    // 4. Resolve Target Identity from live database
    // A) Check public.users
    const { data: targetUser } = await supabaseClient
      .from('users')
      .select('id, email, role, status')
      .eq('id', targetUserId)
      .maybeSingle();

    // B) Check public.student_profiles
    const { data: targetProfile } = await supabaseClient
      .from('student_profiles')
      .select('user_id, full_name, roll_number')
      .eq('user_id', targetUserId)
      .maybeSingle();

    // C) Check public.coordinators
    const { data: targetCoord } = await supabaseClient
      .from('coordinators')
      .select('id, username, display_name, status')
      .eq('id', targetUserId)
      .maybeSingle();

    // 5. Authorize and Execute according to KITS-EOS Authorization Matrix
    if (targetUser) {
      // Target is a registered user in public.users
      if (targetUser.role === 'ADMIN') {
        if (targetUserId === callerIdentity.userId) {
          // CASE 1: Logged-in Admin A -> target is student profile linked/protected to Admin A
          if (!targetProfile) {
            throw new HttpError(400, 'NO_STUDENT_PROFILE', 'Your administrator account does not have a linked student profile.');
          }

          // ALLOW: Update password in auth.users
          const { data: updatedAuth, error: updateErr } = await supabaseClient.auth.admin.updateUserById(targetUserId, {
            password: newPassword,
          });

          if (updateErr || !updatedAuth) {
            console.error('Failed to update admin-student password:', updateErr);
            throw new HttpError(500, 'AUTH_UPDATE_FAILED', updateErr?.message || 'Failed to update student authentication password.');
          }

          const studentDisplayName = targetProfile.full_name || targetUser.email;

          // Re-authenticate admin with the newly set password to generate a fresh, active session
          // This keeps the Admin's session active and prevents subsequent operations from failing with session_not_found
          let freshSession: any = null;
          try {
            const { data: signinData, error: signinErr } = await supabaseClient.auth.signInWithPassword({
              email: targetUser.email,
              password: newPassword,
            });
            if (!signinErr && signinData?.session) {
              freshSession = {
                access_token: signinData.session.access_token,
                refresh_token: signinData.session.refresh_token,
                expires_at: signinData.session.expires_at,
              };
            }
          } catch (e) {
            console.warn('Could not re-authenticate admin after password update:', e);
          }

          // Audit log
          await supabaseClient.from('audit_logs').insert({
            actor_id: callerIdentity.userId,
            action: 'RESET_OWN_LINKED_STUDENT_PASSWORD',
            entity_type: 'STUDENT_USER',
            entity_id: targetUserId,
            metadata: {
              target_email: targetUser.email,
              target_name: studentDisplayName,
              target_roll: targetProfile.roll_number || null,
              performed_by_email: callerIdentity.email,
              is_dual_admin: true,
              timestamp: new Date().toISOString(),
            },
          });

          return new Response(
            JSON.stringify({
              success: true,
              message: `Password for ${studentDisplayName} (${targetUser.email}) has been successfully updated.`,
              session: freshSession,
              student: {
                id: targetUserId,
                email: targetUser.email,
                name: studentDisplayName,
              },
            }),
            {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        } else {
          // targetUserId !== callerIdentity.userId
          if (targetProfile) {
            // CASE 2: Logged-in Admin A -> target is student linked/protected to Admin B
            throw new HttpError(403, 'FORBIDDEN_PROTECTED_ACCOUNT', 'This student account is administratively linked to another Administrator. Modification denied.');
          } else {
            // CASE 4: Logged-in Admin A -> target is another Admin
            throw new HttpError(403, 'FORBIDDEN_ADMIN_TARGET', 'Cannot reset administrator credentials via this administrative endpoint.');
          }
        }
      } else if (targetUser.role === 'STUDENT') {
        // CASE 3: Logged-in Admin A -> target is an ordinary student with no protected relationship
        if (targetUser.status === 'DEACTIVATED' || targetUser.status === 'ANONYMIZED') {
          throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'Cannot reset password for deactivated or anonymized accounts.');
        }

        // ALLOW: Update password in auth.users
        const { data: updatedAuth, error: updateErr } = await supabaseClient.auth.admin.updateUserById(targetUserId, {
          password: newPassword,
        });

        if (updateErr || !updatedAuth) {
          console.error('Failed to update student password:', updateErr);
          throw new HttpError(500, 'AUTH_UPDATE_FAILED', updateErr?.message || 'Failed to update student authentication password.');
        }

        const studentDisplayName = targetProfile?.full_name || targetUser.email;

        // Audit log
        await supabaseClient.from('audit_logs').insert({
          actor_id: callerIdentity.userId,
          action: 'RESET_STUDENT_PASSWORD',
          entity_type: 'STUDENT_USER',
          entity_id: targetUserId,
          metadata: {
            target_email: targetUser.email,
            target_name: studentDisplayName,
            target_roll: targetProfile?.roll_number || null,
            performed_by_email: callerIdentity.email,
            timestamp: new Date().toISOString(),
          },
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: `Password for ${studentDisplayName} (${targetUser.email}) has been successfully updated.`,
            student: {
              id: targetUserId,
              email: targetUser.email,
              name: studentDisplayName,
            },
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } else {
        throw new HttpError(403, 'UNSUPPORTED_ROLE', 'Cannot reset credentials for this account role.');
      }
    } else if (targetCoord) {
      // CASE 5: Logged-in Admin A -> target is a Coordinator
      // Existing KITS-EOS Admin permission model permits Admins to manage Coordinator credentials
      const computedHash = await hashPassword(newPassword.trim());

      const { error: updateCoordErr } = await supabaseClient
        .from('coordinators')
        .update({ password_hash: computedHash })
        .eq('id', targetCoord.id);

      if (updateCoordErr) {
        console.error('Failed to update coordinator password:', updateCoordErr);
        throw new HttpError(500, 'DATABASE_ERROR', 'Failed to update coordinator password.');
      }

      // Invalidate active coordinator sessions
      await supabaseClient
        .from('coordinator_sessions')
        .delete()
        .eq('coordinator_id', targetCoord.id);

      // Audit log
      await supabaseClient.from('audit_logs').insert({
        actor_id: callerIdentity.userId,
        action: 'RESET_COORDINATOR_PASSWORD',
        entity_type: 'COORDINATOR',
        entity_id: targetCoord.id,
        metadata: {
          coordinator_username: targetCoord.username,
          coordinator_name: targetCoord.display_name,
          performed_by_email: callerIdentity.email,
          timestamp: new Date().toISOString(),
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: `Password for coordinator ${targetCoord.display_name} (${targetCoord.username}) has been successfully updated.`,
          coordinator: {
            id: targetCoord.id,
            username: targetCoord.username,
            name: targetCoord.display_name,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else {
      throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'Target student or coordinator record was not found in the database.');
    }
  } catch (err: any) {
    return handleError(err, corsHeaders);
  }
});
