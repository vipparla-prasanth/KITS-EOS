import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "../_shared/auth.ts";
import { handleError, HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { safelyDeleteBannerAsset } from "../_shared/assetLifecycle.ts";

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

    // 2. Parse & Validate Input
    let body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
    }

    const { event_id, name, description, banner_path, start_date, end_date, status } = body;
    
    if (!event_id || typeof event_id !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Valid event_id is required');
    }

    // 3. Verify Target Event Exists
    const { data: existingEvent, error: fetchError } = await supabaseClient
      .from('events')
      .select('*')
      .eq('id', event_id)
      .single();

    if (fetchError || !existingEvent) {
      throw new HttpError(404, 'NOT_FOUND', 'Event not found');
    }

    // 4. Validate Explicit Update Payload
    const updates: Record<string, any> = {};
    const changes: Record<string, { from: any, to: any }> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Event name cannot be empty');
      }
      if (name.length > 255) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Event name must be under 255 characters');
      }
      const upperName = name.trim().toUpperCase();
      if (existingEvent.name !== upperName) {
        updates.name = upperName;
        changes.name = { from: existingEvent.name, to: updates.name };
      }
    }

    if (description !== undefined) {
      if (description !== null && typeof description !== 'string') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Description must be a string');
      }
      const trimmedDescription = description ? description.trim() : null;
      if (existingEvent.description !== trimmedDescription) {
        updates.description = trimmedDescription;
        changes.description = { from: existingEvent.description, to: updates.description };
      }
    }

    if (banner_path !== undefined) {
      if (banner_path !== null && typeof banner_path !== 'string') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Banner path must be a string');
      }
      if (existingEvent.banner_path !== banner_path) {
        updates.banner_path = banner_path;
        changes.banner_path = { from: existingEvent.banner_path, to: updates.banner_path };
      }
    }

    let newStartDateStr = existingEvent.start_date;
    let newEndDateStr = existingEvent.end_date;
    let datesChanged = false;

    if (start_date !== undefined) {
      const parsedStartDate = new Date(start_date);
      if (isNaN(parsedStartDate.getTime())) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Valid start_date is required');
      }
      if (existingEvent.start_date !== parsedStartDate.toISOString()) {
        newStartDateStr = parsedStartDate.toISOString();
        updates.start_date = newStartDateStr;
        changes.start_date = { from: existingEvent.start_date, to: updates.start_date };
        datesChanged = true;
      }
    }

    if (end_date !== undefined) {
      const parsedEndDate = new Date(end_date);
      if (isNaN(parsedEndDate.getTime())) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Valid end_date is required');
      }
      if (existingEvent.end_date !== parsedEndDate.toISOString()) {
        newEndDateStr = parsedEndDate.toISOString();
        updates.end_date = newEndDateStr;
        changes.end_date = { from: existingEvent.end_date, to: updates.end_date };
        datesChanged = true;
      }
    }

    if (datesChanged) {
      const finalStartDate = new Date(newStartDateStr);
      const finalEndDate = new Date(newEndDateStr);
      if (finalEndDate <= finalStartDate) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'end_date must be strictly after start_date');
      }
    }

    if (status !== undefined) {
      if (status !== 'ACTIVE' && status !== 'ARCHIVED') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid status. Must be ACTIVE or ARCHIVED.');
      }
      if (existingEvent.status !== status) {
        updates.status = status;
        changes.status = { from: existingEvent.status, to: updates.status };
      }
    }

    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ success: true, event: existingEvent, no_op: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 5. Perform Update
    const { data: updatedEvent, error: updateError } = await supabaseClient
      .from('events')
      .update(updates)
      .eq('id', event_id)
      .select('id, name, description, banner_path, start_date, end_date, status, created_at')
      .single();

    if (updateError) {
      console.error("Failed to update event:", updateError);
      throw new HttpError(500, 'DATABASE_ERROR', 'Failed to update event');
    }

    // 6. Safe Post-Update Storage Asset Cleanup:
    // If banner_path was replaced or cleared, safely purge the old banner asset from Storage with outbox tracking.
    if (changes.banner_path && changes.banner_path.from) {
      await safelyDeleteBannerAsset(supabaseClient, changes.banner_path.from, {
        sourceEntityType: 'EVENT',
        sourceEntityId: event_id,
        operation: changes.banner_path.to ? 'REPLACE' : 'MANUAL_REMOVE'
      });
    }

    // 7. Audit Log
    const { error: auditError } = await supabaseClient
      .from('audit_logs')
      .insert({
        actor_id: identity.userId,
        action: changes.banner_path ? (updates.banner_path ? 'EVENT_BANNER_REPLACED' : 'EVENT_BANNER_DELETED') : 'EVENT_UPDATE',
        entity_type: 'events',
        entity_id: updatedEvent.id,
        metadata: {
          changes,
          ip: req.headers.get('x-forwarded-for') || 'Unknown',
        }
      });

    if (auditError) {
      console.error("Failed to insert audit log:", auditError);
    }

    return new Response(JSON.stringify({ success: true, event: updatedEvent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});

