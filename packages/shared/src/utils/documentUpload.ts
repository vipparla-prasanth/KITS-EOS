/**
 * Centralized, mobile-resilient document upload utility for KITS-EOS.
 * Handles:
 * 1. Strict 20 MB pre-upload limit validation.
 * 2. Mobile-safe in-memory ArrayBuffer conversion (preventing Android ContentProvider stream disconnection).
 * 3. Filename & path sanitization.
 * 4. Explicit Bearer token & Content-Type headers for Supabase Storage.
 * 5. Optional database metadata recording when registrationId is provided.
 * 6. User-friendly error messages (distinguishing network, auth, size, and storage errors).
 */

export const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024; // 20 MB in bytes

export class DocumentUploadError extends Error {
  code: 'EXCEEDS_SIZE_LIMIT' | 'FILE_READ_ERROR' | 'AUTH_REQUIRED' | 'NETWORK_ERROR' | 'PERMISSION_DENIED' | 'STORAGE_ERROR' | 'DATABASE_ERROR';

  constructor(
    code: 'EXCEEDS_SIZE_LIMIT' | 'FILE_READ_ERROR' | 'AUTH_REQUIRED' | 'NETWORK_ERROR' | 'PERMISSION_DENIED' | 'STORAGE_ERROR' | 'DATABASE_ERROR',
    message: string
  ) {
    super(message);
    this.name = 'DocumentUploadError';
    this.code = code;
  }
}

export interface UploadRegistrationDocumentParams {
  file: File;
  docConfig: { id?: string; name: string };
  userId: string;
  subEventId: string;
  registrationId?: string | null;
  supabaseClient: any;
  replaceDocumentId?: string;
  replaceStoragePath?: string;
}

export interface UploadRegistrationDocumentResult {
  name: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  document_id?: string;
}

/**
 * Executes a resilient document upload to Supabase Storage and records metadata if registrationId is provided.
 */
export async function uploadRegistrationDocument({
  file,
  docConfig,
  userId,
  subEventId,
  registrationId,
  supabaseClient,
  replaceDocumentId,
  replaceStoragePath,
}: UploadRegistrationDocumentParams): Promise<UploadRegistrationDocumentResult> {
  if (!file) {
    throw new DocumentUploadError('FILE_READ_ERROR', 'No file selected.');
  }

  // 1. Strict 20 MB limit check
  if (file.size > MAX_DOCUMENT_SIZE) {
    throw new DocumentUploadError(
      'EXCEEDS_SIZE_LIMIT',
      'This document exceeds the maximum upload limit of 20 MB.'
    );
  }

  if (!userId) {
    throw new DocumentUploadError('AUTH_REQUIRED', 'User authentication required for document upload.');
  }

  // 2. Read into ArrayBuffer in memory to prevent mobile ContentProvider stream stalling
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch (err: any) {
    console.error('Failed to read file into memory:', err);
    throw new DocumentUploadError(
      'FILE_READ_ERROR',
      'Unable to read document on your device. Please try choosing the file again.'
    );
  }

  // 3. Authenticate and retrieve current session token
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new DocumentUploadError(
      'AUTH_REQUIRED',
      'Your authentication session has expired. Please refresh the page or sign in again.'
    );
  }

  // 4. Sanitize extension, MIME type, and path
  const rawExt = file.name.includes('.') ? file.name.split('.').pop() || '' : '';
  const cleanExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '') ||
    (file.type.includes('pdf') ? 'pdf' : file.type.includes('png') ? 'png' : file.type.includes('jpeg') || file.type.includes('jpg') ? 'jpg' : 'bin');

  const cleanDocName = (docConfig.name || 'document').replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `registrations/${userId}/${subEventId}/${Date.now()}_${cleanDocName}.${cleanExt}`;

  const contentType = file.type || 
    (cleanExt === 'pdf' ? 'application/pdf' : cleanExt === 'png' ? 'image/png' : cleanExt === 'jpg' || cleanExt === 'jpeg' ? 'image/jpeg' : 'application/octet-stream');

  // 5. Direct binary upload to Supabase Storage with explicit Bearer token
  const { data: uploadData, error: uploadErr } = await supabaseClient.storage
    .from('documents')
    .upload(path, arrayBuffer, {
      contentType,
      upsert: true,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

  if (uploadErr) {
    console.error('Supabase storage upload error:', uploadErr);
    const msg = uploadErr.message || '';

    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network')) {
      throw new DocumentUploadError(
        'NETWORK_ERROR',
        'Unable to upload the document. Please check your internet connection and try again.'
      );
    }
    if (msg.includes('violates row-level') || msg.includes('permission denied')) {
      throw new DocumentUploadError(
        'PERMISSION_DENIED',
        'Permission denied for document upload. Please verify your active session.'
      );
    }
    if (msg.includes('Payload too large') || msg.includes('413') || msg.includes('exceeded')) {
      throw new DocumentUploadError(
        'EXCEEDS_SIZE_LIMIT',
        'This document exceeds the maximum upload limit of 20 MB.'
      );
    }
    throw new DocumentUploadError(
      'STORAGE_ERROR',
      msg || 'Failed to upload document to storage server. Please try again.'
    );
  }

  const finalPath = uploadData?.path || path;
  let documentId: string | undefined;

  // 6. If registrationId is present, atomically record document metadata in public.documents
  if (registrationId) {
    const { data: insertedDoc, error: insertErr } = await supabaseClient
      .from('documents')
      .insert({
        owner_id: userId,
        entity_type: 'REGISTRATION',
        entity_id: registrationId,
        storage_path: finalPath,
        file_name: file.name,
        mime_type: contentType,
        size_bytes: file.size,
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('Failed to record document metadata in public.documents:', insertErr);
      // State C: Storage upload succeeded + database insert failed -> attempt cleanup of newly uploaded storage file
      try {
        await supabaseClient.storage.from('documents').remove([finalPath]);
      } catch (cleanupErr) {
        // State E: Log cleanup error separately, preserve original DB error
        console.warn('Storage cleanup after database insert failure failed:', cleanupErr);
      }
      throw new DocumentUploadError(
        'DATABASE_ERROR',
        'File uploaded successfully, but database registration link failed. Please try again.'
      );
    }
    documentId = insertedDoc?.id;

    // Document replacement cleanup: If replacing an existing document record, clean up old metadata and storage object
    if (replaceDocumentId) {
      try {
        await supabaseClient.from('documents').delete().eq('id', replaceDocumentId);
      } catch (delErr) {
        console.warn('Failed to delete replaced document database record:', delErr);
      }
    }
    if (replaceStoragePath && replaceStoragePath !== finalPath) {
      try {
        await supabaseClient.storage.from('documents').remove([replaceStoragePath]);
      } catch (delErr) {
        console.warn('Failed to remove replaced document storage object:', delErr);
      }
    }
  }

  return {
    name: docConfig.name,
    storage_path: finalPath,
    file_name: file.name,
    mime_type: contentType,
    size_bytes: file.size,
    document_id: documentId,
  };
}
