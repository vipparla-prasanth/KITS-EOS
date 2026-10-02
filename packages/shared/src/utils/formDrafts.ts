/**
 * KITS-EOS Persistent Form Drafts Utility
 *
 * Security & Reliability Guarantees:
 * 1. Explicit Owner Namespace: owner_type ('STUDENT', 'ADMIN', 'COORDINATOR').
 * 2. Strict Sanitization: Excludes passwords, tokens, hashes, and secrets from JSONB.
 * 3. Multi-Tab Synchronization: BroadcastChannel('kits_eos_draft_sync') notifies tabs of saves.
 * 4. Stale-Write Protection: Optimistic concurrency using incrementing version numbers.
 * 5. Retention: 30-day database persistence independent of 15-minute auth session.
 */

import { supabase } from '../api/client';

export type DraftOwnerType = 'STUDENT' | 'ADMIN' | 'COORDINATOR';

export type DraftType =
  | 'STUDENT_REGISTRATION'
  | 'ADMIN_EVENT_CREATE'
  | 'ADMIN_EVENT_EDIT'
  | 'ADMIN_CATEGORY_CREATE'
  | 'ADMIN_CATEGORY_EDIT'
  | 'ADMIN_SUB_EVENT_CREATE'
  | 'ADMIN_SUB_EVENT_EDIT'
  | 'COORDINATOR_WORKFLOW';

export interface FormDraft<T = any> {
  id: string;
  owner_type: DraftOwnerType;
  draft_type: DraftType;
  entity_id: string | null;
  title: string | null;
  payload: T;
  current_step: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface DraftSaveResult {
  success: boolean;
  draft_id?: string;
  version?: number;
  updated_at?: string;
  conflict?: boolean;
  code?: string;
  message?: string;
  current_version?: number;
  current_updated_at?: string;
  current_payload?: any;
  current_step?: number;
}

export interface DraftSyncMessage {
  type: 'DRAFT_SAVED' | 'DRAFT_DELETED';
  draft_id: string;
  draft_type: DraftType;
  entity_id?: string | null;
  version?: number;
  updated_at?: string;
  timestamp: number;
}

const SENSITIVE_KEY_REGEX = /password|password_hash|token|coordSession|session_token|secret|api_key|service_role|card|cvv|auth_token/i;

/**
 * Recursively removes sensitive credential fields from any draft payload.
 */
export function sanitizeDraftPayload<T>(payload: T): T {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map(sanitizeDraftPayload) as unknown as T;
  }
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      continue; // Exclude sensitive key
    }
    if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizeDraftPayload(value);
    } else {
      clean[key] = value;
    }
  }
  return clean as T;
}

let draftSyncChannel: BroadcastChannel | null = null;

export function getDraftSyncChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!draftSyncChannel) {
    try {
      draftSyncChannel = new BroadcastChannel('kits_eos_draft_sync');
    } catch {
      draftSyncChannel = null;
    }
  }
  return draftSyncChannel;
}

export function broadcastDraftUpdate(msg: DraftSyncMessage): void {
  const channel = getDraftSyncChannel();
  if (channel) {
    try {
      channel.postMessage(msg);
    } catch {
      // ignore
    }
  }
}

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Validates and extracts a clean UUID string from any entity or draft ID input.
 * Protects against malformed strings (like `eventId_root`) causing PostgreSQL 22P02 syntax errors.
 */
export function sanitizeEntityId(id?: string | null): string | null {
  if (!id || typeof id !== 'string') return null;
  const trimmed = id.trim();
  const match = trimmed.match(UUID_REGEX);
  return match ? match[0] : null;
}

/**
 * Saves or updates a draft for the authenticated Student or Admin user.
 */
export async function saveUserDraft(params: {
  draftType: DraftType;
  entityId?: string | null;
  title?: string | null;
  payload: any;
  currentStep?: number;
  expectedVersion?: number;
  draftId?: string | null;
}): Promise<DraftSaveResult> {
  const cleanPayload = sanitizeDraftPayload(params.payload);
  const safeEntityId = sanitizeEntityId(params.entityId);
  const safeDraftId = sanitizeEntityId(params.draftId);

  const { data, error } = await supabase.rpc('save_user_draft', {
    p_draft_type: params.draftType,
    p_entity_id: safeEntityId,
    p_title: params.title || null,
    p_payload: cleanPayload,
    p_current_step: params.currentStep || 1,
    p_expected_version: params.expectedVersion || 1,
    p_draft_id: safeDraftId,
  });

  if (error) {
    return {
      success: false,
      code: error.code || 'RPC_ERROR',
      message: error.message || 'Failed to save draft.',
    };
  }

  const result = data as DraftSaveResult;
  if (result.success && result.draft_id) {
    broadcastDraftUpdate({
      type: 'DRAFT_SAVED',
      draft_id: result.draft_id,
      draft_type: params.draftType,
      entity_id: safeEntityId,
      version: result.version,
      updated_at: result.updated_at,
      timestamp: Date.now(),
    });
  }

  return result;
}

/**
 * Retrieves the latest draft for an authenticated user.
 */
export async function getUserDrafts(
  draftType?: DraftType,
  entityId?: string | null
): Promise<FormDraft[]> {
  const safeEntityId = sanitizeEntityId(entityId);
  const { data, error } = await supabase.rpc('get_user_drafts', {
    p_draft_type: draftType || null,
    p_entity_id: safeEntityId,
  });

  if (error || !Array.isArray(data)) {
    return [];
  }
  return data as FormDraft[];
}

/**
 * Deletes a user draft row permanently from the database.
 */
export async function deleteUserDraft(draftId: string): Promise<boolean> {
  const safeDraftId = sanitizeEntityId(draftId);
  if (!safeDraftId) return false;
  const { data, error } = await supabase.rpc('delete_user_draft', {
    p_draft_id: safeDraftId,
  });

  if (error) {
    return false;
  }

  const deleted = Boolean(data?.success);
  if (deleted) {
    broadcastDraftUpdate({
      type: 'DRAFT_DELETED',
      draft_id: draftId,
      draft_type: 'STUDENT_REGISTRATION', // generic broadcast
      timestamp: Date.now(),
    });
  }
  return deleted;
}

/**
 * Coordinator session-based draft APIs
 */
export async function saveCoordinatorDraft(params: {
  token: string;
  draftType: DraftType;
  entityId?: string | null;
  title?: string | null;
  payload: any;
  currentStep?: number;
  expectedVersion?: number;
  draftId?: string | null;
}): Promise<DraftSaveResult> {
  const cleanPayload = sanitizeDraftPayload(params.payload);
  const safeEntityId = sanitizeEntityId(params.entityId);
  const safeDraftId = sanitizeEntityId(params.draftId);

  const { data, error } = await supabase.rpc('save_coordinator_draft', {
    p_token: params.token,
    p_draft_type: params.draftType,
    p_entity_id: safeEntityId,
    p_title: params.title || null,
    p_payload: cleanPayload,
    p_current_step: params.currentStep || 1,
    p_expected_version: params.expectedVersion || 1,
    p_draft_id: safeDraftId,
  });

  if (error) {
    return {
      success: false,
      code: error.code || 'RPC_ERROR',
      message: error.message || 'Failed to save coordinator draft.',
    };
  }

  const result = data as DraftSaveResult;
  if (result.success && result.draft_id) {
    broadcastDraftUpdate({
      type: 'DRAFT_SAVED',
      draft_id: result.draft_id,
      draft_type: params.draftType,
      entity_id: safeEntityId,
      version: result.version,
      updated_at: result.updated_at,
      timestamp: Date.now(),
    });
  }

  return result;
}

export async function getCoordinatorDrafts(
  token: string,
  draftType?: DraftType,
  entityId?: string | null
): Promise<FormDraft[]> {
  const safeEntityId = sanitizeEntityId(entityId);
  const { data, error } = await supabase.rpc('get_coordinator_drafts', {
    p_token: token,
    p_draft_type: draftType || null,
    p_entity_id: safeEntityId,
  });

  if (error || !Array.isArray(data)) {
    return [];
  }
  return data as FormDraft[];
}

export async function deleteCoordinatorDraft(
  token: string,
  draftId: string
): Promise<boolean> {
  const safeDraftId = sanitizeEntityId(draftId);
  if (!safeDraftId) return false;
  const { data, error } = await supabase.rpc('delete_coordinator_draft', {
    p_token: token,
    p_draft_id: safeDraftId,
  });

  if (error) {
    return false;
  }

  const deleted = Boolean(data?.success);
  if (deleted) {
    broadcastDraftUpdate({
      type: 'DRAFT_DELETED',
      draft_id: draftId,
      draft_type: 'COORDINATOR_WORKFLOW',
      timestamp: Date.now(),
    });
  }
  return deleted;
}
