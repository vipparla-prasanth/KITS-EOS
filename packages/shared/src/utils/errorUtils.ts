/**
 * KITS-EOS Error Utilities
 * ============================================================================
 * Safe, robust extraction and normalization of error messages from diverse
 * sources: PostgREST HTTP 400 responses, Supabase RPC exceptions, JavaScript
 * Error instances, raw string errors, or malformed/missing response fields.
 */

export function extractErrorMessage(err: unknown, fallback = 'An unexpected error occurred.'): string {
  if (!err) return fallback;
  if (typeof err === 'string') {
    const trimmed = err.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  if (err instanceof Error && err.message) {
    const trimmed = err.message.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;

    // Standard Error or Supabase PostgREST error: { message: "..." }
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }

    // Supabase Auth or OAuth: { error_description: "..." }
    if (typeof record.error_description === 'string' && record.error_description.trim()) {
      return record.error_description.trim();
    }

    // PostgREST detail: { details: "..." }
    if (typeof record.details === 'string' && record.details.trim()) {
      return record.details.trim();
    }

    // Generic error property: { error: "..." }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }

    // PostgREST hint: { hint: "..." }
    if (typeof record.hint === 'string' && record.hint.trim()) {
      return `${fallback} (Hint: ${record.hint.trim()})`;
    }

    // PostgREST code only: { code: "22023" }
    if (typeof record.code === 'string' && record.code.trim()) {
      return `Server validation error [${record.code.trim()}]: ${fallback}`;
    }
  }

  return fallback;
}
