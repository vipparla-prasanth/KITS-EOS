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
      message: "An unexpected error occurred during document deletion.",
      error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." }
    }),
    { status: 500, headers }
  );
}

/**
 * Normalizes storage path, stripping leading slashes, redundant bucket prefixes,
 * and URL hostnames, while preventing path traversal.
 */
function normalizeStoragePath(rawPath: string): { bucket: string; path: string } {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new HttpError(400, 'INVALID_PATH', 'Storage path must be a non-empty string.');
  }

  let cleaned = rawPath.trim();

  // If path is a full URL, extract bucket and sub-path
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      const url = new URL(cleaned);
      const parts = url.pathname.split('/').filter(Boolean);
      const bucketIdx = parts.findIndex((p) => p === 'documents' || p === 'events');
      if (bucketIdx !== -1 && bucketIdx < parts.length - 1) {
        const bucket = parts[bucketIdx];
        const subPath = parts.slice(bucketIdx + 1).join('/');
        return sanitizePath(bucket, subPath);
      }
    } catch {
      // Fall through to standard string cleanup
    }
  }

  // Strip leading slashes
  cleaned = cleaned.replace(/^\/+/, '');

  let bucket = 'documents';
  if (cleaned.startsWith('documents/')) {
    bucket = 'documents';
    cleaned = cleaned.substring('documents/'.length);
  } else if (cleaned.startsWith('events/')) {
    bucket = 'events';
    cleaned = cleaned.substring('events/'.length);
  }

  return sanitizePath(bucket, cleaned);
}

function sanitizePath(bucket: string, path: string): { bucket: string; path: string } {
  if (path.includes('..') || path.includes('\\')) {
    throw new HttpError(400, 'INVALID_PATH', 'Path traversal characters are not permitted.');
  }
  const clean = path.replace(/\/+/g, '/').replace(/^\/+/, '');
  if (!clean) {
    throw new HttpError(400, 'INVALID_PATH', 'Resolved storage path is empty.');
  }
  return { bucket, path: clean };
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

    // 1. Authenticate Requester (Coordinator, Admin, or Student Owner)
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
    let actorRole: 'COORDINATOR' | 'ADMIN' | 'STUDENT' | null = null;
    let isAdminOverride = false;

    if (coordinatorToken) {
      // Coordinator authentication via custom session token
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
      // User JWT authentication (Admin or Student)
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (
        token &&
        !token.startsWith("ctk_") &&
        !token.startsWith("sb_publishable_") &&
        token !== (Deno.env.get("SUPABASE_ANON_KEY") ?? "")
      ) {
        const { data: { user }, error: authErr } = await supabaseClient.auth.getUser(token);
        if (user && !authErr) {
          const { data: appUser } = await supabaseClient
            .from("users")
            .select("id, role, status, email")
            .eq("id", user.id)
            .maybeSingle();

          if (appUser && appUser.status === "ACTIVE") {
            authUserId = user.id;
            if (appUser.role === "ADMIN") {
              isAdminOverride = true;
              actorRole = "ADMIN";
            } else {
              actorRole = "STUDENT";
            }
          }
        }
      }
    }

    if (!effectiveCoordinatorId && !actorRole) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required: Invalid, inactive, or expired session.');
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

    // Support registrationId for cascading registration document cleanup
    const targetRegId = typeof body?.registrationId === 'string' && body.registrationId.trim().length > 0
      ? body.registrationId.trim()
      : typeof body?.registration_id === 'string' && body.registration_id.trim().length > 0
        ? body.registration_id.trim()
        : null;

    if (targetRegId) {
      const { data: regDocs } = await supabaseClient
        .from('documents')
        .select('id')
        .eq('entity_id', targetRegId)
        .eq('entity_type', 'REGISTRATION');
      if (Array.isArray(regDocs)) {
        for (const rd of regDocs) {
          if (rd.id && !rawIds.includes(rd.id)) {
            rawIds.push(rd.id);
          }
        }
      }
    }

    const documentIds = rawIds
      .filter((id) => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim());

    if (documentIds.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'At least one valid documentId or registrationId is required.');
    }

    // 3. Process each document independently with strict authorization and safe error handling
    const results: Array<{
      id: string;
      status: 'DELETED' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'INVALID' | 'STORAGE_FAILURE' | 'DATABASE_FAILURE';
      file_name?: string;
      storage_path?: string;
      storage_bucket?: string;
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
          message: 'Document no longer exists or was already deleted.',
        });
        continue;
      }

      // Check Authorization
      let isAuthorized = false;
      let regRecord: any = null;

      if (doc.entity_type === 'REGISTRATION') {
        const { data: reg } = await supabaseClient
          .from('registrations')
          .select('id, sub_event_id, leader_id, status')
          .eq('id', doc.entity_id)
          .maybeSingle();
        regRecord = reg;
      }

      if (isAdminOverride) {
        // Admin has universal authority to delete any document
        isAuthorized = true;
      } else if (actorRole === 'COORDINATOR') {
        // Coordinator can only manage documents for their assigned sub-event
        if (doc.entity_type !== 'REGISTRATION') {
          results.push({
            id: docId,
            status: 'INVALID',
            file_name: doc.file_name,
            error: 'Coordinators can only manage registration participant documents.',
          });
          continue;
        }

        if (!regRecord || !regRecord.sub_event_id) {
          results.push({
            id: docId,
            status: 'INVALID',
            file_name: doc.file_name,
            error: 'Associated registration or sub-event record not found.',
          });
          continue;
        }

        const { data: assignment, error: assignErr } = await supabaseClient
          .from('coordinator_assignments')
          .select('id')
          .eq('coordinator_id', effectiveCoordinatorId)
          .eq('sub_event_id', regRecord.sub_event_id)
          .maybeSingle();

        if (!assignErr && assignment) {
          isAuthorized = true;
        } else {
          results.push({
            id: docId,
            status: 'UNAUTHORIZED',
            file_name: doc.file_name,
            error: 'Access denied: You are not assigned to manage the sub-event this document belongs to.',
          });
          continue;
        }
      } else if (actorRole === 'STUDENT') {
        // Student can delete only their own document or documents attached to their registration leadership
        const isDirectOwner = doc.owner_id === authUserId;
        const isRegistrationLeader = regRecord && regRecord.leader_id === authUserId;

        if (isDirectOwner || isRegistrationLeader) {
          isAuthorized = true;
        } else {
          results.push({
            id: docId,
            status: 'UNAUTHORIZED',
            file_name: doc.file_name,
            error: 'Access denied: You do not have permission to delete this document.',
          });
          continue;
        }
      }

      if (!isAuthorized) {
        results.push({
          id: docId,
          status: 'UNAUTHORIZED',
          file_name: doc.file_name,
          error: 'Access denied: Unauthorized document deletion attempt.',
        });
        continue;
      }

      // Resolve and sanitize storage path
      let parsedTarget: { bucket: string; path: string };
      try {
        parsedTarget = normalizeStoragePath(doc.storage_path);
      } catch (err: any) {
        results.push({
          id: docId,
          status: 'INVALID',
          file_name: doc.file_name,
          error: err.message || 'Malformed storage path.',
        });
        continue;
      }

      const { bucket: targetBucket, path: normalizedPath } = parsedTarget;

      // 4. Physical Storage Deletion
      // Requirement: Remove or update metadata ONLY when Storage deletion has succeeded
      // or the object is confirmed already absent. Never report success if file still exists.
      let storageRemoved = false;
      let storageErrorDetail: string | null = null;
      let finalBucketUsed = targetBucket;

      // Primary attempt on resolved bucket
      const { data: removeData1, error: removeErr1 } = await supabaseClient
        .storage
        .from(targetBucket)
        .remove([normalizedPath]);

      if (!removeErr1) {
        storageRemoved = true;
        finalBucketUsed = targetBucket;
      } else {
        console.warn(`Primary storage removal failed on bucket ${targetBucket}:`, removeErr1.message);
        // Fallback attempt on 'events' bucket if primary was 'documents'
        if (targetBucket === 'documents') {
          const { error: removeErr2 } = await supabaseClient
            .storage
            .from('events')
            .remove([normalizedPath]);
          if (!removeErr2) {
            storageRemoved = true;
            finalBucketUsed = 'events';
          } else {
            storageErrorDetail = removeErr1.message || removeErr2.message || 'Failed to remove file from storage.';
          }
        } else {
          storageErrorDetail = removeErr1.message || 'Failed to remove file from storage.';
        }
      }

      // Verification check: ensure file does not still exist in storage
      if (storageRemoved) {
        try {
          const pathSegments = normalizedPath.split('/');
          const targetFileName = pathSegments.pop() || '';
          const folderPrefix = pathSegments.join('/');

          const { data: listCheck, error: listErr } = await supabaseClient
            .storage
            .from(finalBucketUsed)
            .list(folderPrefix, { search: targetFileName, limit: 10 });

          if (!listErr && Array.isArray(listCheck)) {
            const stillPersists = listCheck.some((item) => item.name === targetFileName);
            if (stillPersists) {
              console.error(`Post-removal check failed: ${normalizedPath} still persists in bucket ${finalBucketUsed}.`);
              storageRemoved = false;
              storageErrorDetail = 'Storage object removal was reported, but file still persists in bucket.';
            }
          }
        } catch (verifyErr) {
          console.warn('Storage post-deletion check skipped due to non-blocking error:', verifyErr);
        }
      }

      if (!storageRemoved) {
        results.push({
          id: docId,
          status: 'STORAGE_FAILURE',
          file_name: doc.file_name,
          error: `Storage removal failed: ${storageErrorDetail || 'Object could not be deleted'}. Database record preserved.`,
        });
        continue;
      }

      // 5. Database Metadata Deletion (Only after storage removal succeeded or confirmed absent)
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
          error: `Storage file removed, but database metadata deletion failed: ${dbDeleteErr.message}`,
        });
        continue;
      }

      // 6. Immutable Audit Logging
      try {
        await supabaseClient
          .from('audit_logs')
          .insert({
            actor_id: effectiveCoordinatorId || authUserId || null,
            action: 'DOCUMENT_PERMANENTLY_DELETED',
            entity_type: 'DOCUMENT',
            entity_id: doc.id,
            metadata: {
              document_id: doc.id,
              file_name: doc.file_name,
              storage_path: normalizedPath,
              storage_bucket: finalBucketUsed,
              raw_storage_path: doc.storage_path,
              entity_type: doc.entity_type,
              entity_id: doc.entity_id,
              actor_role: actorRole,
              actor_id: effectiveCoordinatorId || authUserId,
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
        storage_path: normalizedPath,
        storage_bucket: finalBucketUsed,
        message: 'Document permanently removed from storage and database.',
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
