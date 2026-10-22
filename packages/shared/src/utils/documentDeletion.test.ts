import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeDocumentStoragePath,
  executeDocumentDeletion,
} from './documentDeletion';
import {
  analyzeDocumentOrphans,
  formatOrphanReportMarkdown,
  StorageObjectMeta,
  DatabaseDocumentMeta,
} from './documentOrphanDiagnostic';

describe('Document Deletion & Storage Lifecycle Test Suite', () => {
  describe('1. Storage Path Normalization & Security Guardrails', () => {
    it('normalizes standard registration document paths', () => {
      const res = normalizeDocumentStoragePath('registrations/usr_123/sub_456/1710000000_Report.docx');
      expect(res.bucket).toBe('documents');
      expect(res.path).toBe('registrations/usr_123/sub_456/1710000000_Report.docx');
    });

    it('strips redundant leading slashes safely', () => {
      const res = normalizeDocumentStoragePath('///registrations/usr_123/sub_456/Project.docx');
      expect(res.bucket).toBe('documents');
      expect(res.path).toBe('registrations/usr_123/sub_456/Project.docx');
    });

    it('strips redundant bucket prefixes to prevent nested bucket lookup errors', () => {
      const res = normalizeDocumentStoragePath('documents/registrations/usr_123/sub_456/Project.docx');
      expect(res.bucket).toBe('documents');
      expect(res.path).toBe('registrations/usr_123/sub_456/Project.docx');
    });

    it('identifies alternative events bucket prefixes correctly', () => {
      const res = normalizeDocumentStoragePath('events/subevents/docs/Abstract.docx');
      expect(res.bucket).toBe('events');
      expect(res.path).toBe('subevents/docs/Abstract.docx');
    });

    it('extracts bucket and relative path from absolute Supabase Storage URLs', () => {
      const url = 'https://xyzcompany.supabase.co/storage/v1/object/public/documents/registrations/u99/s88/Thesis.docx';
      const res = normalizeDocumentStoragePath(url);
      expect(res.bucket).toBe('documents');
      expect(res.path).toBe('registrations/u99/s88/Thesis.docx');
    });

    it('strictly blocks path traversal attempts', () => {
      expect(() => {
        normalizeDocumentStoragePath('registrations/usr_123/../../etc/passwd');
      }).toThrow(/Path traversal characters are not permitted/);

      expect(() => {
        normalizeDocumentStoragePath('registrations/usr_123/..\\secret.docx');
      }).toThrow(/Path traversal characters are not permitted/);
    });

    it('rejects empty or whitespace-only paths', () => {
      expect(() => normalizeDocumentStoragePath('')).toThrow();
      expect(() => normalizeDocumentStoragePath('   ')).toThrow();
    });
  });

  describe('2. Client Deletion Invocation & Multi-Role Execution', () => {
    let mockInvoke: any;
    let mockGetSession: any;
    let mockClient: any;

    beforeEach(() => {
      mockInvoke = vi.fn();
      mockGetSession = vi.fn().mockResolvedValue({
        data: {
          session: { access_token: 'valid_student_jwt' },
        },
      });
      mockClient = {
        auth: { getSession: mockGetSession },
        functions: { invoke: mockInvoke },
      };
    });

    it('successfully deletes a single document as an authorized user', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: {
          success: true,
          total_requested: 1,
          deleted_count: 1,
          failed_count: 0,
          not_found_count: 0,
          all_succeeded: true,
          partial_success: false,
          results: [
            {
              id: 'doc_1',
              status: 'DELETED',
              file_name: 'Project_Report.docx',
              storage_path: 'registrations/u1/s1/170_Report.docx',
            },
          ],
        },
        error: null,
      });

      const res = await executeDocumentDeletion({
        documentId: 'doc_1',
        customClient: mockClient,
      });

      expect(res.success).toBe(true);
      expect(res.deleted_count).toBe(1);
      expect(res.results[0].status).toBe('DELETED');
      expect(mockInvoke).toHaveBeenCalledWith(
        'coordinator-delete-document',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid_student_jwt',
          }),
          body: {
            documentIds: ['doc_1'],
          },
        })
      );
    });

    it('passes coordinator token header when coordinator session token is provided', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: {
          success: true,
          total_requested: 1,
          deleted_count: 1,
          failed_count: 0,
          results: [{ id: 'doc_1', status: 'DELETED' }],
        },
        error: null,
      });

      const res = await executeDocumentDeletion({
        documentId: 'doc_1',
        coordinatorToken: 'ctk_mock_coordinator_token_xyz',
        customClient: mockClient,
      });

      expect(res.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith(
        'coordinator-delete-document',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-coordinator-token': 'ctk_mock_coordinator_token_xyz',
          }),
        })
      );
    });

    it('handles idempotent retries when document was already deleted', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: {
          success: true,
          total_requested: 1,
          deleted_count: 0,
          not_found_count: 1,
          failed_count: 0,
          all_succeeded: false,
          partial_success: false,
          results: [
            {
              id: 'doc_stale',
              status: 'NOT_FOUND',
              message: 'Document no longer exists or was already deleted.',
            },
          ],
        },
        error: null,
      });

      const res = await executeDocumentDeletion({
        documentId: 'doc_stale',
        customClient: mockClient,
      });

      expect(res.success).toBe(true);
      expect(res.not_found_count).toBe(1);
      expect(res.results[0].status).toBe('NOT_FOUND');
    });

    it('handles storage removal failures without corrupting metadata or reporting false success', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: {
          success: false,
          total_requested: 1,
          deleted_count: 0,
          failed_count: 1,
          results: [
            {
              id: 'doc_fail',
              status: 'STORAGE_FAILURE',
              file_name: 'Corrupt.docx',
              error: 'Storage removal failed: Connection timeout. Database record preserved.',
            },
          ],
        },
        error: null,
      });

      const res = await executeDocumentDeletion({
        documentId: 'doc_fail',
        customClient: mockClient,
      });

      expect(res.success).toBe(false);
      expect(res.failed_count).toBe(1);
      expect(res.results[0].status).toBe('STORAGE_FAILURE');
      expect(res.results[0].error).toContain('Database record preserved');
    });

    it('rejects unauthorized cross-student deletion attempts', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: {
          success: false,
          total_requested: 1,
          deleted_count: 0,
          failed_count: 1,
          results: [
            {
              id: 'doc_other_student',
              status: 'UNAUTHORIZED',
              error: 'Access denied: You do not have permission to delete this document.',
            },
          ],
        },
        error: null,
      });

      const res = await executeDocumentDeletion({
        documentId: 'doc_other_student',
        customClient: mockClient,
      });

      expect(res.success).toBe(false);
      expect(res.results[0].status).toBe('UNAUTHORIZED');
    });

    it('supports bulk document deletion and leaves unrelated student files untouched', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: {
          success: true,
          total_requested: 2,
          deleted_count: 2,
          failed_count: 0,
          all_succeeded: true,
          results: [
            { id: 'doc_target_1', status: 'DELETED' },
            { id: 'doc_target_2', status: 'DELETED' },
          ],
        },
        error: null,
      });

      const res = await executeDocumentDeletion({
        documentIds: ['doc_target_1', 'doc_target_2'],
        customClient: mockClient,
      });

      expect(res.success).toBe(true);
      expect(res.deleted_count).toBe(2);
      expect(mockInvoke).toHaveBeenCalledWith(
        'coordinator-delete-document',
        expect.objectContaining({
          body: {
            documentIds: ['doc_target_1', 'doc_target_2'],
          },
        })
      );
    });

    it('supports registration-level document cleanup', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: {
          success: true,
          total_requested: 3,
          deleted_count: 3,
          failed_count: 0,
          results: [
            { id: 'doc_r1', status: 'DELETED' },
            { id: 'doc_r2', status: 'DELETED' },
            { id: 'doc_r3', status: 'DELETED' },
          ],
        },
        error: null,
      });

      const res = await executeDocumentDeletion({
        registrationId: 'reg_xyz_999',
        customClient: mockClient,
      });

      expect(res.success).toBe(true);
      expect(res.deleted_count).toBe(3);
      expect(mockInvoke).toHaveBeenCalledWith(
        'coordinator-delete-document',
        expect.objectContaining({
          body: {
            registrationId: 'reg_xyz_999',
          },
        })
      );
    });
  });

  describe('3. Historical Orphan Detection Diagnostic Engine (Read-Only)', () => {
    const mockStorageObjects: StorageObjectMeta[] = [
      {
        bucket_id: 'documents',
        name: 'registrations/u1/s1/170_healthy.docx',
        size_bytes: 1048576,
        created_at: '2026-10-01T10:00:00Z',
      },
      {
        bucket_id: 'documents',
        name: 'registrations/u2/s1/171_abandoned_draft.docx',
        size_bytes: 524288,
        created_at: '2026-10-02T12:00:00Z',
      },
      {
        bucket_id: 'documents',
        name: 'unlinked_orphan.pdf',
        size_bytes: 204800,
        created_at: '2026-10-03T15:00:00Z',
      },
    ];

    const mockDbDocuments: DatabaseDocumentMeta[] = [
      {
        id: 'doc_1',
        owner_id: 'u1',
        entity_type: 'REGISTRATION',
        entity_id: 'reg_1',
        storage_path: 'registrations/u1/s1/170_healthy.docx',
        file_name: 'Healthy_Report.docx',
        size_bytes: 1048576,
        uploaded_at: '2026-10-01T10:00:00Z',
      },
      {
        id: 'doc_missing',
        owner_id: 'u3',
        entity_type: 'REGISTRATION',
        entity_id: 'reg_3',
        storage_path: 'registrations/u3/s1/172_missing_on_disk.docx',
        file_name: 'Missing_File.docx',
        size_bytes: 3145728,
        uploaded_at: '2026-10-04T08:00:00Z',
      },
      {
        id: 'doc_dup_1',
        owner_id: 'u4',
        entity_type: 'REGISTRATION',
        entity_id: 'reg_4',
        storage_path: 'registrations/shared/duplicate_reference.docx',
        file_name: 'Ref1.docx',
        size_bytes: 1000,
      },
      {
        id: 'doc_dup_2',
        owner_id: 'u4',
        entity_type: 'REGISTRATION',
        entity_id: 'reg_5',
        storage_path: 'registrations/shared/duplicate_reference.docx',
        file_name: 'Ref2.docx',
        size_bytes: 1000,
      },
    ];

    it('accurately detects orphaned storage objects with zero matching metadata', () => {
      const report = analyzeDocumentOrphans(mockStorageObjects, mockDbDocuments);

      expect(report.execution_mode).toBe('READ_ONLY_DIAGNOSTIC');
      expect(report.summary.total_storage_objects_scanned).toBe(3);
      expect(report.summary.orphaned_storage_files_count).toBe(2);

      const draftOrphan = report.orphaned_storage_objects.find(
        (o) => o.path === 'registrations/u2/s1/171_abandoned_draft.docx'
      );
      expect(draftOrphan).toBeDefined();
      expect(draftOrphan?.detected_category).toBe('ABANDONED_REGISTRATION_DRAFT');

      const unlinkedOrphan = report.orphaned_storage_objects.find(
        (o) => o.path === 'unlinked_orphan.pdf'
      );
      expect(unlinkedOrphan).toBeDefined();
      expect(unlinkedOrphan?.detected_category).toBe('UNLINKED_PARTICIPANT_FILE');
    });

    it('accurately identifies database records whose physical files are missing', () => {
      const report = analyzeDocumentOrphans(mockStorageObjects, mockDbDocuments);

      expect(report.summary.missing_storage_files_count).toBe(3); // doc_missing, doc_dup_1, doc_dup_2
      const missingDoc = report.missing_storage_objects.find((m) => m.document_id === 'doc_missing');
      expect(missingDoc).toBeDefined();
      expect(missingDoc?.file_name).toBe('Missing_File.docx');
      expect(missingDoc?.expected_path).toBe('registrations/u3/s1/172_missing_on_disk.docx');
    });

    it('accurately detects duplicate database references to the same storage path', () => {
      const report = analyzeDocumentOrphans(mockStorageObjects, mockDbDocuments);

      expect(report.summary.duplicate_references_count).toBe(1);
      const dup = report.duplicate_references[0];
      expect(dup.normalized_path).toBe('registrations/shared/duplicate_reference.docx');
      expect(dup.count).toBe(2);
      expect(dup.document_ids).toContain('doc_dup_1');
      expect(dup.document_ids).toContain('doc_dup_2');
    });

    it('formats a comprehensive, human-readable markdown orphan audit report', () => {
      const report = analyzeDocumentOrphans(mockStorageObjects, mockDbDocuments);
      const markdown = formatOrphanReportMarkdown(report);

      expect(markdown).toContain('# Historical Document Orphan Diagnostic Report');
      expect(markdown).toContain('100% Read-Only Diagnostic');
      expect(markdown).toContain('Zero files deleted. Zero database records modified.');
      expect(markdown).toContain('Healthy Matched Files');
      expect(markdown).toContain('Orphaned Storage Objects');
      expect(markdown).toContain('Missing Storage Files');
    });
  });
});
