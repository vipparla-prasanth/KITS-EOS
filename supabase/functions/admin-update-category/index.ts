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

    const { category_id, name, description, status } = body;
    
    if (!category_id || typeof category_id !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'category_id is required');
    }

    const updates: any = {};
    const changes: any = {};

    // 3. Verify Category Exists
    const { data: existingCategory, error: fetchError } = await supabaseClient
      .from('categories')
      .select('*')
      .eq('id', category_id)
      .single();

    if (fetchError || !existingCategory) {
      throw new HttpError(404, 'NOT_FOUND', 'Category not found');
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Category name cannot be empty');
      }
      if (name.length > 255) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Category name must be under 255 characters');
      }
      const upperName = name.trim().toUpperCase();
      if (existingCategory.name !== upperName) {
        updates.name = upperName;
        changes.name = { old: existingCategory.name, new: updates.name };
      }
    }

    if (description !== undefined) {
      if (description !== null && typeof description !== 'string') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Description must be a string');
      }
      const trimmed = description ? description.trim() : null;
      if (existingCategory.description !== trimmed) {
        updates.description = trimmed;
        changes.description = { old: existingCategory.description, new: updates.description };
      }
    }

    if (status !== undefined) {
      if (status !== 'ACTIVE' && status !== 'ARCHIVED') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid status. Must be ACTIVE or ARCHIVED.');
      }
      if (existingCategory.status !== status) {
        updates.status = status;
        changes.status = { old: existingCategory.status, new: updates.status };
      }
    }

    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ success: true, category: existingCategory, no_op: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 4. Perform Update
    const { data: category, error: updateError } = await supabaseClient
      .from('categories')
      .update(updates)
      .eq('id', category_id)
      .select('id, event_id, name, description, status, created_at')
      .single();

    if (updateError) {
      console.error("Failed to update category:", updateError);
      throw new HttpError(500, 'DATABASE_ERROR', 'Failed to update category');
    }

    // 5. Audit Log
    const { error: auditError } = await supabaseClient
      .from('audit_logs')
      .insert({
        actor_id: identity.userId,
        action: 'CATEGORY_UPDATE',
        entity_type: 'categories',
        entity_id: category.id,
        metadata: {
          changes,
          ip: req.headers.get('x-forwarded-for') || 'Unknown',
        }
      });

    if (auditError) {
      console.error("Failed to insert audit log:", auditError);
    }

    return new Response(JSON.stringify({ success: true, category }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
