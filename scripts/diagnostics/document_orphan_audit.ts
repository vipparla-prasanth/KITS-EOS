/**
 * Historical Document Orphan Audit Runner
 * Connects to Supabase, reads all objects in bucket 'documents',
 * reads all metadata from public.documents, and generates a structured
 * diagnostic report.
 *
 * SAFETY GUARANTEE: Strictly read-only. Does not mutate database records
 * or delete storage objects.
 */

import {
  analyzeDocumentOrphans,
  formatOrphanReportMarkdown,
  StorageObjectMeta,
  DatabaseDocumentMeta,
  OrphanDiagnosticReport,
} from '../../packages/shared/src/utils/documentOrphanDiagnostic';

export async function runOrphanAuditWithClient(supabaseClient: any): Promise<OrphanDiagnosticReport> {
  // 1. Fetch all records from public.documents in batches
  const dbDocs: DatabaseDocumentMeta[] = [];
  let from = 0;
  const batchSize = 500;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabaseClient
      .from('documents')
      .select('id, owner_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, uploaded_at')
      .range(from, from + batchSize - 1);

    if (error) {
      throw new Error(`Failed to read public.documents metadata: ${error.message}`);
    }

    if (data && Array.isArray(data)) {
      dbDocs.push(...data);
      if (data.length < batchSize) {
        hasMore = false;
      } else {
        from += batchSize;
      }
    } else {
      hasMore = false;
    }
  }

  // 2. Scan Supabase Storage bucket 'documents' recursively (read-only list)
  const storageObjects: StorageObjectMeta[] = [];

  async function scanBucketFolder(bucketId: string, folder = ''): Promise<void> {
    const { data: items, error: listErr } = await supabaseClient.storage
      .from(bucketId)
      .list(folder, { limit: 100, sortBy: { column: 'name', order: 'asc' } });

    if (listErr) {
      console.warn(`[OrphanAudit] Warning listing bucket ${bucketId} folder "${folder}":`, listErr.message);
      return;
    }

    if (!items || !Array.isArray(items)) return;

    for (const item of items) {
      const fullPath = folder ? `${folder}/${item.name}` : item.name;
      // In Supabase storage, folders have id === null or no metadata/size
      if (!item.id && !item.metadata) {
        // Likely a sub-folder, recurse
        await scanBucketFolder(bucketId, fullPath);
      } else {
        storageObjects.push({
          bucket_id: bucketId,
          name: fullPath,
          id: item.id,
          created_at: item.created_at,
          updated_at: item.updated_at,
          size_bytes: item.metadata?.size || item.size_bytes || 0,
          metadata: item.metadata,
        });
      }
    }
  }

  try {
    await scanBucketFolder('documents', '');
  } catch (scanErr: any) {
    console.warn('[OrphanAudit] Primary bucket scan warning:', scanErr.message);
  }

  // 3. Run pure audit analysis
  const report = analyzeDocumentOrphans(storageObjects, dbDocs);
  return report;
}

// Standalone execution if run with environment variables
if (typeof process !== 'undefined' && process.env?.RUN_DIAGNOSTIC === 'true') {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (supabaseUrl && serviceKey) {
    const client = createClient(supabaseUrl, serviceKey);
    runOrphanAuditWithClient(client)
      .then((report) => {
        console.log(formatOrphanReportMarkdown(report));
      })
      .catch((err) => {
        console.error('Audit failed:', err);
        process.exit(1);
      });
  } else {
    console.log('Orphan diagnostic audit loaded. Run with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to execute against database.');
  }
}
