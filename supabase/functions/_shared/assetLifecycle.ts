/**
 * Production Asset Lifecycle Utilities for Supabase Storage
 * 
 * Enforces strict namespace boundaries, transactional outbox queue processing,
 * and safe backend-authoritative deletion for Event and Sub-Event banner assets.
 * Strictly prevents deletion of student documents, registration assets, or arbitrary paths.
 */

const STORAGE_URL_PATTERN = '/storage/v1/object/public/events/';

/**
 * Extracts the storage object path relative to the 'events' bucket.
 * Handles full URLs, relative paths, query parameters, and cleans leading slashes.
 */
export function extractBannerStoragePath(urlOrPath: string | null | undefined): string | null {
  if (!urlOrPath || typeof urlOrPath !== 'string') {
    return null;
  }

  let cleaned = urlOrPath.trim();
  if (!cleaned) return null;

  // If fully qualified Supabase Storage URL
  const patternIndex = cleaned.indexOf(STORAGE_URL_PATTERN);
  if (patternIndex !== -1) {
    cleaned = cleaned.substring(patternIndex + STORAGE_URL_PATTERN.length);
  }

  // Remove leading slashes
  cleaned = cleaned.replace(/^\/+/, '');

  // Strip query strings or hash params if any
  const queryIndex = cleaned.indexOf('?');
  if (queryIndex !== -1) {
    cleaned = cleaned.substring(0, queryIndex);
  }

  return validateBannerStoragePath(cleaned) ? cleaned : null;
}

/**
 * Validates that the storage path strictly resides within authorized banner namespaces.
 * Protects against directory traversal ('..'), double slashes, and unauthorized bucket targets.
 * Avoids restrictive filename assumptions while strictly locking down prefixes.
 */
export function validateBannerStoragePath(path: string | null | undefined): boolean {
  if (!path || typeof path !== 'string') return false;

  // Prevent directory traversal and backslashes
  if (path.includes('..') || path.includes('//') || path.includes('\\')) {
    return false;
  }

  // Strictly enforce banner namespace prefixes
  const isEventBanner = path.startsWith('events/banners/') && path.length > 'events/banners/'.length;
  const isSubEventBanner = path.startsWith('subevents/banners/') && path.length > 'subevents/banners/'.length;

  return isEventBanner || isSubEventBanner;
}

export interface ProcessQueueResult {
  processed: number;
  succeeded: number;
  failed: number;
  jobs: Array<{
    id: string;
    path: string;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Processes queued storage cleanup jobs from public.storage_cleanup_queue using
 * atomic PostgreSQL job claiming (FOR UPDATE SKIP LOCKED).
 */
export async function processStorageCleanupQueue(
  supabaseClient: any,
  batchSize: number = 10
): Promise<ProcessQueueResult> {
  const result: ProcessQueueResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    jobs: []
  };

  try {
    // 1. Atomically claim jobs
    const { data: claimedJobs, error: claimError } = await supabaseClient.rpc(
      'claim_storage_cleanup_jobs',
      { p_batch_size: batchSize }
    );

    if (claimError) {
      console.error('[AssetLifecycle] Error claiming cleanup jobs:', claimError.message);
      return result;
    }

    if (!claimedJobs || !Array.isArray(claimedJobs) || claimedJobs.length === 0) {
      return result;
    }

    // 2. Process each claimed job
    for (const job of claimedJobs) {
      result.processed++;
      const { id: jobId, storage_bucket: bucket, storage_path: path } = job;

      // Validate path strictly once more before touching storage
      if (!validateBannerStoragePath(path) || bucket !== 'events') {
        const validationErr = `Rejected invalid storage path or bucket: ${bucket}/${path}`;
        console.warn(`[AssetLifecycle] ${validationErr}`);
        await supabaseClient.rpc('complete_storage_cleanup_job', {
          p_job_id: jobId,
          p_success: false,
          p_error_message: validationErr
        });
        result.failed++;
        result.jobs.push({ id: jobId, path, success: false, error: validationErr });
        continue;
      }

      try {
        // Physical deletion from Supabase Storage
        const { error: storageError } = await supabaseClient.storage.from(bucket).remove([path]);

        if (storageError) {
          console.warn(`[AssetLifecycle] Storage removal failed for "${path}":`, storageError.message);
          await supabaseClient.rpc('complete_storage_cleanup_job', {
            p_job_id: jobId,
            p_success: false,
            p_error_message: storageError.message
          });
          result.failed++;
          result.jobs.push({ id: jobId, path, success: false, error: storageError.message });
        } else {
          await supabaseClient.rpc('complete_storage_cleanup_job', {
            p_job_id: jobId,
            p_success: true
          });
          result.succeeded++;
          result.jobs.push({ id: jobId, path, success: true });
        }
      } catch (err: any) {
        const errorMsg = err?.message || 'Unknown storage removal exception';
        console.warn(`[AssetLifecycle] Unexpected exception removing "${path}":`, errorMsg);
        await supabaseClient.rpc('complete_storage_cleanup_job', {
          p_job_id: jobId,
          p_success: false,
          p_error_message: errorMsg
        });
        result.failed++;
        result.jobs.push({ id: jobId, path, success: false, error: errorMsg });
      }
    }
  } catch (err: any) {
    console.error('[AssetLifecycle] Queue processing failure:', err?.message || err);
  }

  return result;
}

/**
 * Safely removes a banner asset from the 'events' storage bucket with outbox tracking.
 * Used during banner replacement and manual banner removal.
 */
export async function safelyDeleteBannerAsset(
  supabaseClient: any,
  urlOrPath: string | null | undefined,
  context?: {
    sourceEntityType: 'EVENT' | 'SUB_EVENT';
    sourceEntityId?: string;
    operation: 'REPLACE' | 'MANUAL_REMOVE';
  }
): Promise<{ deleted: boolean; path: string | null; error?: string }> {
  const path = extractBannerStoragePath(urlOrPath);
  if (!path) {
    return { deleted: false, path: null };
  }

  try {
    // 1. If context provided, record in storage_cleanup_queue
    let jobId: string | null = null;
    if (context) {
      const assetType = path.startsWith('events/banners/') ? 'EVENT_BANNER' : 'SUB_EVENT_BANNER';
      const { data: queueEntry } = await supabaseClient
        .from('storage_cleanup_queue')
        .insert({
          storage_bucket: 'events',
          storage_path: path,
          asset_type: assetType,
          source_entity_type: context.sourceEntityType,
          source_entity_id: context.sourceEntityId || null,
          operation: context.operation,
          status: 'PROCESSING',
          attempt_count: 0,
          processing_started_at: new Date().toISOString()
        })
        .select('id')
        .maybeSingle();

      jobId = queueEntry?.id || null;
    }

    // 2. Physical Storage removal
    const { error: removeError } = await supabaseClient.storage.from('events').remove([path]);

    if (removeError) {
      console.warn(`[AssetLifecycle] Storage removal warning for "${path}":`, removeError.message);
      if (jobId) {
        await supabaseClient.rpc('complete_storage_cleanup_job', {
          p_job_id: jobId,
          p_success: false,
          p_error_message: removeError.message
        });
      }
      return { deleted: false, path, error: removeError.message };
    }

    if (jobId) {
      await supabaseClient.rpc('complete_storage_cleanup_job', {
        p_job_id: jobId,
        p_success: true
      });
    }

    return { deleted: true, path };
  } catch (err: any) {
    console.warn(`[AssetLifecycle] Unexpected error removing banner "${path}":`, err?.message || err);
    return { deleted: false, path, error: err?.message || 'Unknown error' };
  }
}
