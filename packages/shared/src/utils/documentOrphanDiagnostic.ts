/**
 * Read-Only Historical Orphan Detection Diagnostic for KITS-EOS.
 * Compares Supabase Storage objects with public.documents database metadata
 * to identify orphaned files, missing storage objects, and duplicate references.
 *
 * NOTE: Strictly read-only. Does not mutate database records or delete storage files.
 */

import { normalizeDocumentStoragePath } from './documentDeletion';

export interface StorageObjectMeta {
  name: string;
  bucket_id: string;
  id?: string;
  created_at?: string;
  updated_at?: string;
  size_bytes?: number;
  metadata?: Record<string, any>;
}

export interface DatabaseDocumentMeta {
  id: string;
  owner_id?: string | null;
  entity_type: string;
  entity_id: string;
  storage_path: string;
  file_name: string;
  mime_type?: string;
  size_bytes: number;
  uploaded_at?: string;
}

export interface OrphanedStorageObject {
  bucket: string;
  path: string;
  size_bytes?: number;
  created_at?: string;
  detected_category: 'ABANDONED_REGISTRATION_DRAFT' | 'UNLINKED_PARTICIPANT_FILE' | 'UNKNOWN';
}

export interface MissingStorageObject {
  document_id: string;
  expected_bucket: string;
  expected_path: string;
  file_name: string;
  owner_id?: string | null;
  entity_type: string;
  entity_id: string;
  size_bytes: number;
  uploaded_at?: string;
}

export interface DuplicateMetadataReference {
  normalized_path: string;
  bucket: string;
  count: number;
  document_ids: string[];
  file_names: string[];
}

export interface OrphanDiagnosticReport {
  execution_mode: 'READ_ONLY_DIAGNOSTIC';
  generated_at: string;
  summary: {
    total_storage_objects_scanned: number;
    total_database_records_scanned: number;
    orphaned_storage_files_count: number;
    orphaned_storage_total_bytes: number;
    missing_storage_files_count: number;
    duplicate_references_count: number;
    healthy_matching_files_count: number;
  };
  orphaned_storage_objects: OrphanedStorageObject[];
  missing_storage_objects: MissingStorageObject[];
  duplicate_references: DuplicateMetadataReference[];
}

/**
 * Pure analysis function comparing Storage objects and Database document rows.
 */
export function analyzeDocumentOrphans(
  storageObjects: StorageObjectMeta[],
  dbDocuments: DatabaseDocumentMeta[]
): OrphanDiagnosticReport {
  const normalizedDbMap = new Map<string, DatabaseDocumentMeta[]>();

  // 1. Index database records by normalized bucket + path key
  for (const doc of dbDocuments) {
    try {
      const { bucket, path } = normalizeDocumentStoragePath(doc.storage_path);
      const key = `${bucket}:${path.toLowerCase()}`;
      const existing = normalizedDbMap.get(key) || [];
      existing.push(doc);
      normalizedDbMap.set(key, existing);
    } catch {
      // In case of completely unparseable path, index by raw string
      const rawKey = `documents:${doc.storage_path.toLowerCase()}`;
      const existing = normalizedDbMap.get(rawKey) || [];
      existing.push(doc);
      normalizedDbMap.set(rawKey, existing);
    }
  }

  // 2. Index storage objects by normalized bucket + path key
  const normalizedStorageMap = new Map<string, StorageObjectMeta>();
  for (const obj of storageObjects) {
    try {
      const { bucket, path } = normalizeDocumentStoragePath(`${obj.bucket_id}/${obj.name}`);
      const key = `${bucket}:${path.toLowerCase()}`;
      normalizedStorageMap.set(key, obj);
    } catch {
      const rawKey = `${obj.bucket_id || 'documents'}:${obj.name.toLowerCase()}`;
      normalizedStorageMap.set(rawKey, obj);
    }
  }

  // 3. Find Orphaned Storage Objects (in Storage, but NO DB record)
  const orphaned_storage_objects: OrphanedStorageObject[] = [];
  let orphaned_storage_total_bytes = 0;
  let healthy_matching_files_count = 0;

  for (const [key, obj] of normalizedStorageMap.entries()) {
    if (!normalizedDbMap.has(key)) {
      // Categorize orphan
      let category: OrphanedStorageObject['detected_category'] = 'UNKNOWN';
      if (obj.name.startsWith('registrations/') || obj.name.includes('/')) {
        category = 'ABANDONED_REGISTRATION_DRAFT';
      } else {
        category = 'UNLINKED_PARTICIPANT_FILE';
      }

      orphaned_storage_objects.push({
        bucket: obj.bucket_id,
        path: obj.name,
        size_bytes: obj.size_bytes,
        created_at: obj.created_at,
        detected_category: category,
      });
      orphaned_storage_total_bytes += Number(obj.size_bytes || 0);
    } else {
      healthy_matching_files_count++;
    }
  }

  // 4. Find Missing Storage Objects (in DB, but missing from Storage)
  const missing_storage_objects: MissingStorageObject[] = [];
  for (const [key, docs] of normalizedDbMap.entries()) {
    if (!normalizedStorageMap.has(key)) {
      for (const doc of docs) {
        let expectedBucket = 'documents';
        let expectedPath = doc.storage_path;
        try {
          const norm = normalizeDocumentStoragePath(doc.storage_path);
          expectedBucket = norm.bucket;
          expectedPath = norm.path;
        } catch {
          // keep fallback
        }

        missing_storage_objects.push({
          document_id: doc.id,
          expected_bucket: expectedBucket,
          expected_path: expectedPath,
          file_name: doc.file_name,
          owner_id: doc.owner_id,
          entity_type: doc.entity_type,
          entity_id: doc.entity_id,
          size_bytes: doc.size_bytes,
          uploaded_at: doc.uploaded_at,
        });
      }
    }
  }

  // 5. Find Duplicate Metadata References (multiple DB records pointing to the same storage path)
  const duplicate_references: DuplicateMetadataReference[] = [];
  for (const [key, docs] of normalizedDbMap.entries()) {
    if (docs.length > 1) {
      const [bucket, path] = key.split(':');
      duplicate_references.push({
        normalized_path: path,
        bucket,
        count: docs.length,
        document_ids: docs.map((d) => d.id),
        file_names: docs.map((d) => d.file_name),
      });
    }
  }

  return {
    execution_mode: 'READ_ONLY_DIAGNOSTIC',
    generated_at: new Date().toISOString(),
    summary: {
      total_storage_objects_scanned: storageObjects.length,
      total_database_records_scanned: dbDocuments.length,
      orphaned_storage_files_count: orphaned_storage_objects.length,
      orphaned_storage_total_bytes,
      missing_storage_files_count: missing_storage_objects.length,
      duplicate_references_count: duplicate_references.length,
      healthy_matching_files_count,
    },
    orphaned_storage_objects,
    missing_storage_objects,
    duplicate_references,
  };
}

/**
 * Formats diagnostic audit report as clean GitHub-flavored markdown.
 */
export function formatOrphanReportMarkdown(report: OrphanDiagnosticReport): string {
  const { summary, orphaned_storage_objects, missing_storage_objects, duplicate_references } = report;

  return `# Historical Document Orphan Diagnostic Report

> **Mode:** 100% Read-Only Diagnostic
> **Generated:** ${report.generated_at}
> **Enforcement Notice:** Zero files deleted. Zero database records modified.

---

## 1. Executive Summary

| Metric | Count | Details |
| :--- | :--- | :--- |
| **Storage Objects Scanned** | \`${summary.total_storage_objects_scanned}\` | Files present in Supabase Storage |
| **Database Records Scanned** | \`${summary.total_database_records_scanned}\` | Metadata rows in \`public.documents\` |
| **Healthy Matched Files** | \`${summary.healthy_matching_files_count}\` | File in Storage matches active DB record |
| **Orphaned Storage Files** | \`${summary.orphaned_storage_files_count}\` | Files in Storage with NO matching DB row (\`${(summary.orphaned_storage_total_bytes / (1024 * 1024)).toFixed(2)} MB\`) |
| **Missing Storage Files** | \`${summary.missing_storage_files_count}\` | DB rows pointing to non-existent storage files |
| **Duplicate DB References** | \`${summary.duplicate_references_count}\` | Multiple DB records pointing to identical file key |

---

## 2. Orphaned Storage Objects (Files with No Matching Metadata)

${
  orphaned_storage_objects.length === 0
    ? '*No orphaned storage objects found. All files correspond to registered metadata records.*'
    : orphaned_storage_objects
        .map(
          (o, idx) =>
            `${idx + 1}. **\`${o.bucket}/${o.path}\`** — Category: \`${o.detected_category}\` (${((o.size_bytes || 0) / 1024).toFixed(1)} KB)`
        )
        .join('\n')
}

---

## 3. Missing Storage Files (Metadata Records with Absent Files)

${
  missing_storage_objects.length === 0
    ? '*No missing storage files found. All database records point to existing physical storage files.*'
    : missing_storage_objects
        .map(
          (m, idx) =>
            `${idx + 1}. **\`${m.file_name}\`** (Doc ID: \`${m.document_id}\`, Entity: \`${m.entity_type}:${m.entity_id}\`) — Expected Path: \`${m.expected_bucket}/${m.expected_path}\``
        )
        .join('\n')
}

---

## 4. Duplicate or Stale References

${
  duplicate_references.length === 0
    ? '*No duplicate storage path references detected in metadata records.*'
    : duplicate_references
        .map(
          (d, idx) =>
            `${idx + 1}. Path: **\`${d.bucket}/${d.normalized_path}\`** referenced by ${d.count} records: [${d.document_ids.join(', ')}]`
        )
        .join('\n')
}
`;
}
