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

    const { event_id, name, description, status = 'ACTIVE' } = body;
    
    if (!event_id || typeof event_id !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Parent event_id is required');
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Category name is required');
    }
    
    if (name.length > 255) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Category name must be under 255 characters');
    }
    
    if (description !== undefined && description !== null && typeof description !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Description must be a string');
    }

    if (status !== 'ACTIVE' && status !== 'ARCHIVED') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid status. Must be ACTIVE or ARCHIVED.');
    }

    // 3. Verify Parent Event Exists
    const { data: event, error: eventError } = await supabaseClient
      .from('events')
      .select('id')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid event_id: Parent event does not exist');
    }

    // 4. Perform Insert
    const { data: category, error: insertError } = await supabaseClient
      .from('categories')
      .insert({ 
        event_id,
        name: name.trim().toUpperCase(),
        description: description ? description.trim() : null,
        status 
      })
      .select('id, event_id, name, description, status, created_at')
      .single();

    if (insertError) {
      console.error("Failed to insert category:", insertError);
      throw new HttpError(500, 'DATABASE_ERROR', 'Failed to create category');
    }

    // 5. Audit Log
    const { error: auditError } = await supabaseClient
      .from('audit_logs')
      .insert({
        actor_id: identity.userId,
        action: 'CATEGORY_CREATE',
        entity_type: 'categories',
        entity_id: category.id,
        metadata: {
          event_id: category.event_id,
          name: category.name,
          status: category.status,
          ip: req.headers.get('x-forwarded-for') || 'Unknown',
        }
      });

    if (auditError) {
      console.error("Failed to insert audit log:", auditError);
      await supabaseClient.from('categories').delete().eq('id', category.id);
      throw new HttpError(500, 'AUDIT_ERROR', 'Failed to create audit record. Operation aborted safely.');
    }

    return new Response(JSON.stringify({ success: true, category }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 201,
    });

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
