import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "../_shared/auth.ts";
import { handleError, HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { safelyDeleteBannerAsset } from "../_shared/assetLifecycle.ts";

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
      sub_event_id,
      faculty_coordinator = null,
      student_coordinator = null,
      ...updateFields 
    } = body;
    
    if (!sub_event_id || typeof sub_event_id !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'sub_event_id is required');
    }
    if (!event_id || typeof event_id !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'event_id is required');
    }

    const updates: any = {};
    const changes: any = {};

    // 3. Verify Sub-event Exists
    const { data: existingSubEvent, error: fetchError } = await supabaseClient
      .from('sub_events')
      .select('*')
      .eq('id', sub_event_id)
      .single();

    if (fetchError || !existingSubEvent) {
      throw new HttpError(404, 'NOT_FOUND', 'Sub-event not found');
    }

    // 4. Build updates
    if (updateFields.name !== undefined) {
      if (typeof updateFields.name !== 'string' || updateFields.name.trim().length === 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Sub-event name cannot be empty');
      }
      const upperName = updateFields.name.trim().toUpperCase();
      updates.name = upperName;
    }
    if (updateFields.description !== undefined) updates.description = updateFields.description;
    if (updateFields.rules !== undefined) updates.rules = updateFields.rules;
    if (updateFields.banner_path !== undefined) {
      if (existingSubEvent.banner_path !== updateFields.banner_path) {
        updates.banner_path = updateFields.banner_path;
        changes.banner_path = { from: existingSubEvent.banner_path, to: updates.banner_path };
      }
    }
    if (updateFields.venue !== undefined) updates.venue = updateFields.venue;
    
    if (updateFields.participation_type !== undefined) {
      if (!['SOLO', 'TEAM', 'BOTH'].includes(updateFields.participation_type)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'participation_type must be SOLO, TEAM, or BOTH');
      }
      updates.participation_type = updateFields.participation_type;
      if (updateFields.participation_type === 'SOLO') {
        updates.max_team_size = 1;
      }
    }
    
    if (updateFields.max_team_size !== undefined && updates.participation_type !== 'SOLO') {
      const size = Number(updateFields.max_team_size);
      if (size < 1) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'max_team_size must be a number >= 1');
      }
      updates.max_team_size = size;
    }

    if (updateFields.is_free !== undefined) {
      const targetIsFree = Boolean(updateFields.is_free);
      if (targetIsFree !== Boolean(existingSubEvent.is_free)) {
        const { count, error: countErr } = await supabaseClient
          .from('registrations')
          .select('*', { count: 'exact', head: true })
          .eq('sub_event_id', sub_event_id)
          .neq('status', 'CANCELLED');
        if (count && count > 0) {
          throw new HttpError(400, 'UNSAFE_PAYMENT_TYPE_CHANGE', 'Cannot change payment type between Free and Paid because active registrations already exist for this sub-event.');
        }
      }
      updates.is_free = targetIsFree;
    }

    if (updates.is_free) {
      updates.fee_amount_solo = 0;
      updates.fee_amount_team = 0;
      updates.payment_mode = 'BOTH';
    } else {
      if (updateFields.fee_amount_solo !== undefined) updates.fee_amount_solo = Number(updateFields.fee_amount_solo) || 0;
      if (updateFields.fee_amount_team !== undefined) updates.fee_amount_team = Number(updateFields.fee_amount_team) || 0;
      if (updateFields.payment_mode !== undefined) {
        const allowedPaymentModes = ['UPI_ONLY', 'CASH_ONLY', 'BOTH', 'REGISTER_ONLINE_PAY_OFFLINE'];
        if (!allowedPaymentModes.includes(updateFields.payment_mode)) {
          throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid payment_mode. Must be UPI_ONLY, CASH_ONLY, BOTH, or REGISTER_ONLINE_PAY_OFFLINE');
        }
        updates.payment_mode = updateFields.payment_mode;
      }
    }
    if (updateFields.payment_instructions !== undefined) updates.payment_instructions = updateFields.payment_instructions;
    if (updateFields.required_documents !== undefined) updates.required_documents = updateFields.required_documents;
    if (updateFields.attendance_token_prefix !== undefined) updates.attendance_token_prefix = updateFields.attendance_token_prefix;
    if (updateFields.results_locked !== undefined) updates.results_locked = updateFields.results_locked;
    if (updateFields.status !== undefined) {
      if (updateFields.status !== 'ACTIVE' && updateFields.status !== 'ARCHIVED') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid status. Must be ACTIVE or ARCHIVED.');
      }
      updates.status = updateFields.status;
    }

    if (updateFields.start_time !== undefined || updateFields.end_time !== undefined) {
      const s = updateFields.start_time !== undefined ? updateFields.start_time : existingSubEvent.start_time;
      const e = updateFields.end_time !== undefined ? updateFields.end_time : existingSubEvent.end_time;
      
      if (s && e) {
        const sd = new Date(s);
        const ed = new Date(e);
        if (isNaN(sd.getTime()) || isNaN(ed.getTime())) {
          throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid start_time or end_time format');
        }
        if (ed <= sd) {
          throw new HttpError(400, 'VALIDATION_ERROR', 'end_time must be strictly after start_time');
        }
      }
      if (updateFields.start_time !== undefined) updates.start_time = s;
      if (updateFields.end_time !== undefined) updates.end_time = e;
    }

    // 5. Handle Coordinators update if supplied
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
        
        const upsertPayload: any = {
          username,
          display_name: displayName,
          phone_number: phone,
          coordinator_type: item.type,
          status: 'ACTIVE'
        };

        if (coord.password && coord.password.trim()) {
          upsertPayload.password_hash = await hashPassword(coord.password.trim());
        }

        const { data: coordinatorRecord, error: coordError } = await supabaseClient
          .from('coordinators')
          .upsert(upsertPayload, { onConflict: 'username' })
          .select('id')
          .single();

        if (!coordError && coordinatorRecord) {
          await supabaseClient
            .from('coordinator_assignments')
            .upsert(
              {
                coordinator_id: coordinatorRecord.id,
                sub_event_id: existingSubEvent.id
              },
              { onConflict: 'coordinator_id,sub_event_id' }
            );
        }
      }
    }

    // 6. Perform Update if fields changed
    let updatedSubEvent = existingSubEvent;
    if (Object.keys(updates).length > 0) {
      const { data: resultSubEvent, error: updateError } = await supabaseClient
        .from('sub_events')
        .update(updates)
        .eq('id', sub_event_id)
        .select('*')
        .single();

      if (updateError) {
        console.error("Failed to update sub-event:", updateError);
        throw new HttpError(500, 'DATABASE_ERROR', 'Failed to update sub-event');
      }
      updatedSubEvent = resultSubEvent;
    }

    // 7. Safe Post-Update Storage Asset Cleanup:
    // If banner_path was replaced or cleared, safely purge the old banner asset from Storage with outbox tracking.
    if (changes.banner_path && changes.banner_path.from) {
      await safelyDeleteBannerAsset(supabaseClient, changes.banner_path.from, {
        sourceEntityType: 'SUB_EVENT',
        sourceEntityId: updatedSubEvent.id,
        operation: changes.banner_path.to ? 'REPLACE' : 'MANUAL_REMOVE'
      });
    }

    // 8. Audit Log
    await supabaseClient
      .from('audit_logs')
      .insert({
        actor_id: identity.userId,
        action: changes.banner_path ? (updates.banner_path ? 'SUB_EVENT_BANNER_REPLACED' : 'SUB_EVENT_BANNER_DELETED') : 'SUB_EVENT_UPDATE',
        entity_type: 'sub_events',
        entity_id: updatedSubEvent.id,
        metadata: {
          event_id,
          sub_event_id,
          changes,
          ip: req.headers.get('x-forwarded-for') || 'Unknown',
        }
      });

    return new Response(JSON.stringify({ success: true, subEvent: updatedSubEvent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
