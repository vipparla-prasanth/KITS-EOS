// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
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

declare const Deno: any;

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
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

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
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
          throw new HttpError(500, 'AUTH_ERROR', updateErr.message || 'Failed to update student password');
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
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

        // Verify target student exists
        const { data: targetUser, error: fetchErr } = await supabaseClient
          .from('users')
          .select('id, email, role')
          .eq('id', user_id)
          .single();

        if (fetchErr || !targetUser) {
          throw new HttpError(404, 'NOT_FOUND', 'Target student user not found');
        }

        // Fetch student profile for audit records
        const { data: profile } = await supabaseClient
          .from('student_profiles')
          .select('roll_number, full_name')
          .eq('user_id', user_id)
          .maybeSingle();

        // 1. Delete feedback & complaints submitted by student
        await supabaseClient.from('feedback').delete().eq('user_id', user_id);
        await supabaseClient.from('complaints').delete().eq('user_id', user_id);

        // 2. Find all registrations where user is leader
        const { data: leadRegistrations } = await supabaseClient
          .from('registrations')
          .select('id')
          .eq('leader_id', user_id);

        if (leadRegistrations && leadRegistrations.length > 0) {
          const regIds = leadRegistrations.map((r: { id: string }) => r.id);
          
          // Delete payments
          await supabaseClient.from('payments').delete().in('registration_id', regIds);

          // Find teams
          const { data: teams } = await supabaseClient
            .from('teams')
            .select('id')
            .in('registration_id', regIds);

          if (teams && teams.length > 0) {
            const teamIds = teams.map((t: { id: string }) => t.id);
            // Delete attendance records
            await supabaseClient.from('attendance').delete().in('team_id', teamIds);
            // Delete team members
            await supabaseClient.from('team_members').delete().in('team_id', teamIds);
            // Delete teams
            await supabaseClient.from('teams').delete().in('id', teamIds);
          }

          // Delete registrations
          await supabaseClient.from('registrations').delete().in('id', regIds);
        }

        // 3. Delete non-leader team membership entries
        await supabaseClient.from('team_members').delete().eq('user_id', user_id);

        // 4. Delete student profile
        await supabaseClient.from('student_profiles').delete().eq('user_id', user_id);

        // 5. Delete public.users record
        await supabaseClient.from('users').delete().eq('id', user_id);

        // 6. Delete auth.users record
        const { error: authDelErr } = await supabaseClient.auth.admin.deleteUser(user_id);
        if (authDelErr) {
          console.error('Error deleting auth.users row:', authDelErr);
        }

        // Audit Log
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
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

        // Invalidate any active coordinator sessions upon password reset (Security requirement)
        await supabaseClient
          .from('coordinator_sessions')
          .delete()
          .eq('coordinator_id', coordinator_id);

        // Audit Log (Never log passwords)
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
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

        // Remove all coordinator assignments
        await supabaseClient
          .from('coordinator_assignments')
          .delete()
          .eq('coordinator_id', coordinator_id);

        // Delete coordinator record
        const { error: delCoordErr } = await supabaseClient
          .from('coordinators')
          .delete()
          .eq('id', coordinator_id);

        if (delCoordErr) {
          throw new HttpError(500, 'DATABASE_ERROR', 'Failed to delete coordinator');
        }

        // Audit Log
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
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        throw new HttpError(400, 'INVALID_ACTION', `Action "${action}" is not recognized.`);
    }
  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
