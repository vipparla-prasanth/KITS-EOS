/**
 * Secure document deletion utilities for KITS-EOS.
 * Provides client-side helpers to permanently remove student-uploaded documents
 * from Supabase Storage and associated database records via authorized backend services.
 */

import { supabase } from '../api/client';

export type DocumentDeletionStatus =
  | 'DELETED'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INVALID'
  | 'STORAGE_FAILURE'
  | 'DATABASE_FAILURE';

export interface DocumentDeletionItemResult {
  id: string;
  status: DocumentDeletionStatus;
  file_name?: string;
  error?: string;
  message?: string;
  storage_path?: string;
  storage_bucket?: string;
}

export interface DocumentDeletionResponse {
  success: boolean;
  total_requested: number;
  deleted_count: number;
  not_found_count: number;
  failed_count: number;
  all_succeeded: boolean;
  partial_success: boolean;
  results: DocumentDeletionItemResult[];
  message?: string;
}

export interface ExecuteDocumentDeletionParams {
  documentId?: string;
  documentIds?: string[];
  registrationId?: string;
  coordinatorToken?: string | null;
  customClient?: any;
}

/**
 * Normalizes and sanitizes a storage path, extracting the target bucket and relative object key.
 * Removes leading slashes, URL schemes, and redundant bucket prefixes while preventing traversal.
 */
export function normalizeDocumentStoragePath(rawPath: string): { bucket: string; path: string } {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('A valid storage path string is required.');
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
        const path = parts.slice(bucketIdx + 1).join('/');
        return sanitizePathResult(bucket, path);
      }
    } catch {
      // URL parsing failed; fall through to standard string cleanup
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

  return sanitizePathResult(bucket, cleaned);
}

function sanitizePathResult(bucket: string, path: string): { bucket: string; path: string } {
  // Disallow directory traversal
  if (path.includes('..') || path.includes('\\')) {
    throw new Error('Invalid storage path: Path traversal characters are not permitted.');
  }

  // Prevent double slashes
  const normalizedPath = path.replace(/\/+/g, '/').replace(/^\/+/, '');
  if (!normalizedPath) {
    throw new Error('Invalid storage path: Resolved path is empty.');
  }

  return { bucket, path: normalizedPath };
}

/**
 * Executes a secure, permanent document deletion via the server-side Edge Function.
 * Authenticates the caller (Coordinator token, Admin JWT, or Student JWT) and
 * verifies that the file is permanently deleted from Supabase Storage and cleaned up
 * from the database metadata.
 */
export async function executeDocumentDeletion({
  documentId,
  documentIds,
  registrationId,
  coordinatorToken,
  customClient,
}: ExecuteDocumentDeletionParams): Promise<DocumentDeletionResponse> {
  const client = customClient || supabase;

  // Gather target IDs
  const targets: string[] = [];
  if (documentId && typeof documentId === 'string' && documentId.trim().length > 0) {
    targets.push(documentId.trim());
  }
  if (Array.isArray(documentIds)) {
    for (const id of documentIds) {
      if (typeof id === 'string' && id.trim().length > 0 && !targets.includes(id.trim())) {
        targets.push(id.trim());
      }
    }
  }

  if (targets.length === 0 && !registrationId) {
    throw new Error('At least one valid documentId or registrationId is required for deletion.');
  }

  // Construct headers
  const headers: Record<string, string> = {};
  if (coordinatorToken && coordinatorToken.trim().length > 0) {
    headers['x-coordinator-token'] = coordinatorToken.trim();
  } else {
    // Student or Admin JWT session
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const payload: Record<string, any> = {};
  if (targets.length > 0) {
    payload.documentIds = targets;
  }
  if (registrationId && typeof registrationId === 'string') {
    payload.registrationId = registrationId.trim();
  }

  // Invoke Edge Function
  const { data, error } = await client.functions.invoke('coordinator-delete-document', {
    headers,
    body: payload,
  });

  if (error) {
    // Attempt to extract structured error response if available
    let msg = error.message || 'Server error during document deletion.';
    if ((error as any).context && typeof (error as any).context.json === 'function') {
      try {
        const body = await (error as any).context.clone().json();
        if (body?.message || body?.error) {
          msg = body.message || body.error;
        }
      } catch {
        // fallback to default error message
      }
    }
    throw new Error(msg);
  }

  if (!data) {
    throw new Error('No response returned from document deletion service.');
  }

  return {
    success: Boolean(data.success),
    total_requested: Number(data.total_requested || targets.length),
    deleted_count: Number(data.deleted_count || 0),
    not_found_count: Number(data.not_found_count || 0),
    failed_count: Number(data.failed_count || 0),
    all_succeeded: Boolean(data.all_succeeded),
    partial_success: Boolean(data.partial_success),
    results: Array.isArray(data.results) ? data.results : [],
    message: data.message,
  };
}
