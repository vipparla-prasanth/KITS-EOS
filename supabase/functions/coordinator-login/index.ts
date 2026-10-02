import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleError, HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

async function hashString(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
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

    let body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
    }

    const { username, password } = body;
    
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Username is required');
    }
    if (!password || typeof password !== 'string' || !password.trim()) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Password is required');
    }

    const cleanUsername = username.trim();
    const computedHash = await hashString(password.trim());

    // 1. Fetch coordinator by username (Strictly Username + Password, No synthetic email)
    const { data: coordinator, error: coordError } = await supabaseClient
      .from('coordinators')
      .select('id, username, password_hash, display_name, phone_number, coordinator_type, status')
      .eq('username', cleanUsername)
      .single();

    if (coordError || !coordinator) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials. Please check your username and password.');
    }

    if (coordinator.status !== 'ACTIVE') {
      throw new HttpError(403, 'ACCOUNT_INACTIVE', 'Coordinator account is inactive or archived');
    }

    // 2. Verify password hash
    if (coordinator.password_hash !== computedHash) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials. Please check your username and password.');
    }

    // 3. Generate Cryptographically Secure Session Token (256 bits entropy)
    // The raw token is a high-entropy credential returned ONLY to the authenticated client.
    // NEVER log, audit-log, or store the raw token in plaintext in the database.
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const rawToken = 'ctk_' + Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    
    // Compute SHA-256 hash of token to store in database
    const tokenHash = await hashString(rawToken);
    
    // Absolute 1-hour coordinator session expiration
    const sessionDurationMs = 60 * 60 * 1000; // 60 minutes / 1 hour
    const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();

    const ip = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'Unknown';
    const userAgent = req.headers.get('user-agent') || 'Unknown';

    // Insert session into public.coordinator_sessions
    const { error: sessionInsertErr } = await supabaseClient
      .from('coordinator_sessions')
      .insert({
        coordinator_id: coordinator.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
        ip_address: ip,
        user_agent: userAgent,
      });

    if (sessionInsertErr) {
      console.error("Session creation error:", sessionInsertErr.message);
      throw new HttpError(500, 'SESSION_CREATION_ERROR', 'Failed to initialize coordinator session.');
    }

    // 4. Fetch active assignments count
    const { data: activeAssignmentsData } = await supabaseClient
      .from('coordinator_assignments')
      .select(`
        id,
        sub_event_id,
        sub_events!inner (
          id,
          status,
          events (status),
          categories (events (status))
        )
      `)
      .eq('coordinator_id', coordinator.id);

    const validAssignments = (activeAssignmentsData || []).filter((a: any) => {
      const se = a.sub_events;
      if (!se || se.status !== 'ACTIVE') return false;
      const ev = se.events || se.categories?.events;
      return ev?.status === 'ACTIVE';
    });

    const isPaymentManager = coordinator.coordinator_type === 'PAYMENT_MANAGER';
    const accessState = (isPaymentManager || validAssignments.length > 0) ? 'AUTHORIZED' : 'NO_ASSIGNMENTS';
    const assignmentState = isPaymentManager ? 'PAYMENT_MANAGER' : (validAssignments.length > 0 ? 'ACTIVE_ASSIGNMENTS' : 'NO_ACTIVE_ASSIGNMENTS');

    // 5. Audit Log (Strictly sanitize: NEVER record tokens, hashes, or credentials)
    await supabaseClient
      .from('audit_logs')
      .insert({
        actor_id: coordinator.id,
        action: isPaymentManager ? 'PAYMENT_MANAGER_LOGIN' : 'COORDINATOR_LOGIN',
        entity_type: 'coordinators',
        entity_id: coordinator.id,
        metadata: {
          username: coordinator.username,
          coordinator_type: coordinator.coordinator_type,
          assignments_count: validAssignments.length,
          access_state: accessState,
          ip,
        }
      });

    // 6. Return response with session token (treat token as credential)
    return new Response(JSON.stringify({ 
      success: true, 
      session_token: rawToken,
      role: isPaymentManager ? 'PAYMENT_MANAGER' : 'COORDINATOR',
      coordinator: {
        id: coordinator.id,
        username: coordinator.username,
        display_name: coordinator.display_name,
        phone_number: coordinator.phone_number,
        coordinator_type: coordinator.coordinator_type,
        status: coordinator.status,
      },
      access_state: accessState,
      assignment_state: assignmentState,
      expires_at: expiresAt,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
