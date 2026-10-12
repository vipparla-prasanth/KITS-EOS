// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "../_shared/auth.ts";
import { handleError, HttpError } from "../_shared/errorHandling.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

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

  // 2. TEMPORARY FALLBACK (Phase 4A Controlled Migration Only):
  // Retained temporarily to prevent an outage if modern secret resolution fails.
  // Location: resolvePrivilegedKey() fallback branch in admin-update-category/index.ts.
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

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const { key: elevatedKey, isModern } = resolvePrivilegedKey();

    if (!supabaseUrl || !elevatedKey) {
      throw new HttpError(500, 'CONFIGURATION_ERROR', 'Supabase environment configuration missing.');
    }

    const supabaseClient = createClient(supabaseUrl, elevatedKey, {
      auth: { persistSession: false },
    });

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
      return new Response(JSON.stringify({ 
        success: true, 
        category: existingCategory, 
        no_op: true,
        secret_resolution: isModern ? 'SUCCESS' : 'TEMPORARY_FALLBACK'
      }), {
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

    return new Response(JSON.stringify({ 
      success: true, 
      category,
      secret_resolution: isModern ? 'SUCCESS' : 'TEMPORARY_FALLBACK'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
