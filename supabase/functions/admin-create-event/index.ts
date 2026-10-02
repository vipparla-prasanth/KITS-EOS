import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "../_shared/auth.ts";
import { handleError, HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

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

    const { name, description, banner_path, start_date, end_date, status = 'ACTIVE' } = body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Event name is required');
    }
    
    if (name.length > 255) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Event name must be under 255 characters');
    }
    
    if (description !== undefined && description !== null && typeof description !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Description must be a string');
    }

    if (banner_path !== undefined && banner_path !== null && typeof banner_path !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Banner path must be a string');
    }
    
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    
    if (!start_date || isNaN(startDate.getTime())) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Valid start_date is required');
    }
    
    if (!end_date || isNaN(endDate.getTime())) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Valid end_date is required');
    }
    
    if (endDate <= startDate) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'end_date must be strictly after start_date');
    }
    
    if (status !== 'ACTIVE' && status !== 'ARCHIVED') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid status. Must be ACTIVE or ARCHIVED.');
    }

    // 3. Perform Insert
    const { data: event, error: insertError } = await supabaseClient
      .from('events')
      .insert({ 
        name: name.trim().toUpperCase(), 
        description: description ? description.trim() : null,
        banner_path: banner_path || null,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        status 
      })
      .select('id, name, description, banner_path, start_date, end_date, status, created_at')
      .single();

    if (insertError) {
      console.error("Failed to insert event:", insertError);
      throw new HttpError(500, 'DATABASE_ERROR', 'Failed to create event');
    }

    // 4. Audit Log
    const { error: auditError } = await supabaseClient
      .from('audit_logs')
      .insert({
        actor_id: identity.userId,
        action: 'EVENT_CREATE',
        entity_type: 'events',
        entity_id: event.id,
        metadata: {
          name: event.name,
          start_date: event.start_date,
          end_date: event.end_date,
          status: event.status,
          ip: req.headers.get('x-forwarded-for') || 'Unknown',
        }
      });

    if (auditError) {
      console.error("Failed to insert audit log:", auditError);
      await supabaseClient.from('events').delete().eq('id', event.id);
      throw new HttpError(500, 'AUDIT_ERROR', 'Failed to create audit record. Operation aborted safely.');
    }

    return new Response(JSON.stringify({ success: true, event }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 201,
    });

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
