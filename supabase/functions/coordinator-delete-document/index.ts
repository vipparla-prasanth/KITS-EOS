import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
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

  // 2. TEMPORARY FALLBACK (Phase 5D Controlled Migration Only):
  // Retained temporarily to prevent an outage if modern secret resolution fails.
  // Location: resolvePrivilegedKey() fallback branch in coordinator-delete-document/index.ts.
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

class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function handleError(error: unknown, corsHeaders: Record<string, string>, extraHeaders?: Record<string, string>) {
  const headers = { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" };
  if (error instanceof HttpError) {
    return new Response(
      JSON.stringify({
        success: false,
        code: error.code,
        message: error.message,
        error: { code: error.code, message: error.message },
        ...(extraHeaders ? {
          usedModernKey: extraHeaders['x-used-modern-key'] === 'true',
          source: extraHeaders['x-key-source'],
        } : {})
      }),
      { status: error.statusCode, headers }
    );
  }
  console.error("Server Error:", error);
  return new Response(
    JSON.stringify({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." }
    }),
    { status: 500, headers }
  );
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const resolution = resolvePrivilegedKey();
  const isModern = resolution.isModern;
  const modernResponseHeaders = {
    ...corsHeaders,
    'x-secret-resolution': isModern ? 'SUCCESS' : 'TEMPORARY_FALLBACK',
    'x-used-modern-key': isModern ? 'true' : 'false',
    'x-key-source': resolution.source,
  };

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed. Only POST is accepted.');
    }

    if (!resolution.key) {
      throw new HttpError(500, 'CONFIGURATION_ERROR', 'Server configuration error: missing privileged credentials.');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      resolution.key,
      { auth: { persistSession: false } }
    );

    // 1. Authenticate Coordinator or Admin identity
    let coordinatorToken: string | null = req.headers.get("x-coordinator-token");
    const authHeader = req.headers.get("Authorization");
    if (!coordinatorToken && authHeader) {
      const candidate = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (candidate.startsWith("ctk_")) {
        coordinatorToken = candidate;
      }
    }

    let effectiveCoordinatorId: string | null = null;
    let authUserId: string | null = null;
    let actorRole: 'COORDINATOR' | 'ADMIN' | null = null;
    let isAdminOverride = false;

    if (coordinatorToken) {
      const encoder = new TextEncoder();
      const data = encoder.encode(coordinatorToken.trim());
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const tokenHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const { data: sessionData, error: sessionErr } = await supabaseClient
        .from("coordinator_sessions")
        .select(`
          coordinator_id,
          expires_at,
          coordinators!inner (
            id,
            status,
            display_name,
            username
          )
        `)
        .eq("token_hash", tokenHash)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (!sessionErr && sessionData && (sessionData.coordinators as any)?.status === "ACTIVE") {
        effectiveCoordinatorId = sessionData.coordinator_id;
        actorRole = "COORDINATOR";
      }
    } else if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token && !token.startsWith("ctk_") && !token.startsWith("sb_publishable_") && token !== (Deno.env.get("SUPABASE_ANON_KEY") ?? "")) {
        const { data: { user }, error: authErr } = await supabaseClient.auth.getUser(token);
        if (user && !authErr) {
          const { data: appUser } = await supabaseClient
            .from("users")
            .select("role, status, email")
            .eq("id", user.id)
            .maybeSingle();

          if (appUser && appUser.role === "ADMIN" && appUser.status === "ACTIVE") {
            isAdminOverride = true;
            actorRole = "ADMIN";
            authUserId = user.id;
          }
        }
      }
    }

    if (!effectiveCoordinatorId && !isAdminOverride) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Coordinator authorization required: Invalid, inactive, or expired session.');
    }

    // 2. Parse request payload
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
    }

    let rawIds: any[] = [];
    if (Array.isArray(body?.documentIds)) {
      rawIds = body.documentIds;
    } else if (Array.isArray(body?.document_ids)) {
      rawIds = body.document_ids;
    } else if (typeof body?.document_id === 'string') {
      rawIds = [body.document_id];
    } else if (typeof body?.documentId === 'string') {
      rawIds = [body.documentId];
    }

    const documentIds = rawIds
      .filter((id) => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim());

    if (documentIds.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'At least one valid documentId is required.');
    }

    // 3. Process each document independently with strict authorization and safe error handling
    const results: Array<{
      id: string;
      status: 'DELETED' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'INVALID' | 'STORAGE_FAILURE' | 'DATABASE_FAILURE';
      file_name?: string;
      error?: string;
      message?: string;
    }> = [];

    for (const docId of documentIds) {
      const { data: doc, error: docErr } = await supabaseClient
        .from('documents')
        .select('id, owner_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes')
        .eq('id', docId)
        .maybeSingle();

      if (docErr) {
        console.error("Failed to query document:", docErr);
        results.push({
          id: docId,
          status: 'DATABASE_FAILURE',
          error: 'Failed to query document metadata.',
        });
        continue;
      }

      if (!doc) {
        results.push({
          id: docId,
          status: 'NOT_FOUND',
          message: 'Document no longer exists.',
        });
        continue;
      }

      if (doc.entity_type !== 'REGISTRATION') {
        results.push({
          id: docId,
          status: 'INVALID',
          file_name: doc.file_name,
          error: 'Only registration participant documents can be managed by coordinators.',
        });
        continue;
      }

      const { data: reg, error: regErr } = await supabaseClient
        .from('registrations')
        .select('id, sub_event_id, status')
        .eq('id', doc.entity_id)
        .maybeSingle();

      if (regErr || !reg || !reg.sub_event_id) {
        results.push({
          id: docId,
          status: 'INVALID',
          file_name: doc.file_name,
          error: 'Associated registration or sub-event record not found.',
        });
        continue;
      }

      if (!isAdminOverride) {
        const { data: assignment, error: assignErr } = await supabaseClient
          .from('coordinator_assignments')
          .select('id')
          .eq('coordinator_id', effectiveCoordinatorId)
          .eq('sub_event_id', reg.sub_event_id)
          .maybeSingle();

        if (assignErr || !assignment) {
          results.push({
            id: docId,
            status: 'UNAUTHORIZED',
            file_name: doc.file_name,
            error: 'Access denied: You are not assigned to manage the sub-event this document belongs to.',
          });
          continue;
        }
      }

      let storageDeleted = false;
      let storageErrorDetail: string | null = null;
      let targetBucket = 'documents';

      const { error: removeErr1 } = await supabaseClient
        .storage
        .from('documents')
        .remove([doc.storage_path]);

      if (!removeErr1) {
        storageDeleted = true;
      } else {
        const { error: removeErr2 } = await supabaseClient
          .storage
          .from('events')
          .remove([doc.storage_path]);

        if (!removeErr2) {
          storageDeleted = true;
          targetBucket = 'events';
        } else {
          console.error("Storage remove error:", removeErr1, removeErr2);
          storageErrorDetail = 'Failed to remove file from storage.';
        }
      }

      if (!storageDeleted) {
        results.push({
          id: docId,
          status: 'STORAGE_FAILURE',
          file_name: doc.file_name,
          error: `Storage file removal failed. Database record preserved.`,
        });
        continue;
      }

      const { error: dbDeleteErr } = await supabaseClient
        .from('documents')
        .delete()
        .eq('id', doc.id);

      if (dbDeleteErr) {
        console.error("Database metadata delete error:", dbDeleteErr);
        results.push({
          id: docId,
          status: 'DATABASE_FAILURE',
          file_name: doc.file_name,
          error: `Storage file removed, but database metadata deletion failed.`,
        });
        continue;
      }

      try {
        await supabaseClient
          .from('audit_logs')
          .insert({
            actor_id: effectiveCoordinatorId || authUserId || null,
            action: 'COORDINATOR_DELETE_DOCUMENT',
            entity_type: 'DOCUMENT',
            entity_id: doc.id,
            metadata: {
              document_id: doc.id,
              file_name: doc.file_name,
              storage_path: doc.storage_path,
              storage_bucket: targetBucket,
              registration_id: reg.id,
              sub_event_id: reg.sub_event_id,
              actor_role: actorRole,
              coordinator_id: effectiveCoordinatorId,
              deleted_at: new Date().toISOString(),
            }
          });
      } catch (auditErr) {
        console.warn('Audit logging failed for document deletion:', auditErr);
      }

      results.push({
        id: docId,
        status: 'DELETED',
        file_name: doc.file_name,
        message: 'Document deleted successfully from storage and database.',
      });
    }

    const deletedCount = results.filter((r) => r.status === 'DELETED').length;
    const notFoundCount = results.filter((r) => r.status === 'NOT_FOUND').length;
    const failedCount = results.length - deletedCount - notFoundCount;
    const allSucceeded = failedCount === 0 && deletedCount > 0;
    const partialSuccess = deletedCount > 0 && failedCount > 0;

    return new Response(
      JSON.stringify({
        success: failedCount === 0,
        total_requested: documentIds.length,
        deleted_count: deletedCount,
        not_found_count: notFoundCount,
        failed_count: failedCount,
        all_succeeded: allSucceeded,
        partial_success: partialSuccess,
        results,
        usedModernKey: isModern,
        source: resolution.source === 'SUPABASE_SECRET_KEYS' ? 'SUPABASE_SECRET_KEYS' : 'SUPABASE_SERVICE_ROLE_KEY',
        legacyFallbackUsed: !isModern,
      }),
      {
        status: 200,
        headers: modernResponseHeaders,
      }
    );

  } catch (error) {
    return handleError(error, corsHeaders, modernResponseHeaders);
  }
});
