import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "../_shared/auth.ts";
import { handleError, HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

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

    // 1. Authenticate & Authorize
    const identity = await requireRole(req, 'ADMIN', supabaseClient);

    // 2. Validate Input
    let body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
    }

    const { 
      event_id, 
      category_id = null, 
      name, 
      description = null, 
      rules = null,
      banner_path = null,
      start_time = null,
      end_time = null,
      venue = null,
      participation_type,
      max_team_size,
      fee_amount_solo = 0,
      fee_amount_team = 0,
      is_free = false,
      payment_mode = 'BOTH',
      payment_instructions = null,
      required_documents = [],
      attendance_token_prefix = null,
      results_locked = false,
      status = 'ACTIVE',
      faculty_coordinator = null,
      student_coordinator = null,
    } = body;
    
    // Required fields validation
    if (!event_id || typeof event_id !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'event_id is required');
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Sub-event name is required');
    }
    if (name.length > 255) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Sub-event name must be under 255 characters');
    }
    if (!['SOLO', 'TEAM', 'BOTH'].includes(participation_type)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'participation_type must be SOLO, TEAM, or BOTH');
    }
    
    const validatedMaxTeamSize = participation_type === 'SOLO' ? 1 : Number(max_team_size) || 1;
    if (participation_type !== 'SOLO' && validatedMaxTeamSize < 2) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'max_team_size must be a number >= 2 for Team/Both');
    }
    
    // Dates validation
    if (start_time && end_time) {
      const s = new Date(start_time);
      const e = new Date(end_time);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid start_time or end_time format');
      }
      if (e <= s) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'end_time must be strictly after start_time');
      }
    }

    // 3. Verify Hierarchy
    if (category_id) {
      const { data: category, error: categoryError } = await supabaseClient
        .from('categories')
        .select('id, event_id')
        .eq('id', category_id)
        .single();

      if (categoryError || !category) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid category_id: Category does not exist');
      }

      if (category.event_id !== event_id) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Hierarchy mismatch: Category does not belong to the requested event');
      }
    } else {
      const { data: event, error: eventError } = await supabaseClient
        .from('events')
        .select('id')
        .eq('id', event_id)
        .single();

      if (eventError || !event) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid event_id: Event does not exist');
      }
    }

    // Payment mode validation
    const allowedPaymentModes = ['UPI_ONLY', 'CASH_ONLY', 'BOTH', 'REGISTER_ONLINE_PAY_OFFLINE'];
    let validatedPaymentMode = 'BOTH';
    if (!is_free && payment_mode) {
      if (!allowedPaymentModes.includes(payment_mode)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid payment_mode. Must be UPI_ONLY, CASH_ONLY, BOTH, or REGISTER_ONLINE_PAY_OFFLINE');
      }
      validatedPaymentMode = payment_mode;
    }

    // 4. Perform Insert for Sub-event
    const { data: subEvent, error: insertError } = await supabaseClient
      .from('sub_events')
      .insert({ 
        category_id: category_id || null,
        event_id: category_id ? null : event_id,
        name: name.trim().toUpperCase(), 
        description: description ? description.trim() : null,
        rules: rules ? rules.trim() : null,
        banner_path: banner_path || null,
        start_time,
        end_time,
        venue: venue ? venue.trim() : null,
        participation_type,
        max_team_size: validatedMaxTeamSize,
        fee_amount_solo: is_free ? 0 : (Number(fee_amount_solo) || 0),
        fee_amount_team: is_free ? 0 : (Number(fee_amount_team) || 0),
        is_free: Boolean(is_free),
        payment_mode: is_free ? 'BOTH' : validatedPaymentMode,
        payment_instructions: payment_instructions ? payment_instructions.trim() : null,
        required_documents: Array.isArray(required_documents) ? required_documents : [],
        attendance_token_prefix: attendance_token_prefix ? attendance_token_prefix.trim() : null,
        results_locked,
        status 
      })
      .select('*')
      .single();

    if (insertError) {
      console.error("Failed to insert sub-event:", insertError);
      throw new HttpError(500, 'DATABASE_ERROR', 'Failed to create sub-event');
    }

    // 5. Handle Coordinators
    const createdCoordinatorIds: string[] = [];
    const coordinatorsToProcess = [
      { data: faculty_coordinator, type: 'FACULTY' },
      { data: student_coordinator, type: 'STUDENT' },
    ];

    for (const item of coordinatorsToProcess) {
      const coord = item.data;
      if (coord && coord.username && coord.name) {
        const username = coord.username.trim();
        const displayName = coord.name.trim();
        const phone = coord.mobile ? coord.mobile.trim() : null;
        const passwordHash = coord.password ? await hashPassword(coord.password) : await hashPassword('Default@123');

        // Upsert coordinator record
        const { data: coordinatorRecord, error: coordError } = await supabaseClient
          .from('coordinators')
          .upsert(
            {
              username,
              password_hash: passwordHash,
              display_name: displayName,
              phone_number: phone,
              coordinator_type: item.type,
              status: 'ACTIVE'
            },
            { onConflict: 'username' }
          )
          .select('id')
          .single();

        if (coordError || !coordinatorRecord) {
          console.error("Failed to upsert coordinator:", coordError);
        } else {
          createdCoordinatorIds.push(coordinatorRecord.id);
          // Assign to sub-event
          await supabaseClient
            .from('coordinator_assignments')
            .upsert(
              {
                coordinator_id: coordinatorRecord.id,
                sub_event_id: subEvent.id
              },
              { onConflict: 'coordinator_id,sub_event_id' }
            );
        }
      }
    }

    // 6. Audit Log
    const { error: auditError } = await supabaseClient
      .from('audit_logs')
      .insert({
        actor_id: identity.userId,
        action: 'SUB_EVENT_CREATE',
        entity_type: 'sub_events',
        entity_id: subEvent.id,
        metadata: {
          event_id,
          category_id: subEvent.category_id,
          name: subEvent.name,
          participation_type: subEvent.participation_type,
          coordinators_count: createdCoordinatorIds.length,
          ip: req.headers.get('x-forwarded-for') || 'Unknown',
        }
      });

    if (auditError) {
      console.error("Failed to insert audit log:", auditError);
      await supabaseClient.from('sub_events').delete().eq('id', subEvent.id);
      throw new HttpError(500, 'AUDIT_ERROR', 'Failed to create audit record. Operation aborted safely.');
    }

    return new Response(JSON.stringify({ success: true, subEvent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 201,
    });

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
