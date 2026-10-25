import { supabase } from '../api/client';

export interface CleanupSessionNotificationsOptions {
  token?: string | null;
  timeoutMs?: number;
}

export interface CleanupSessionNotificationsResult {
  success: boolean;
  deletedCount: number;
  error?: string;
  source?: 'rpc' | 'direct_delete' | 'noop';
}

// In-flight deduplication key to prevent concurrent redundant cleanup executions
let inFlightCleanupPromise: Promise<CleanupSessionNotificationsResult> | null = null;

/**
 * Automatically purges the authenticated user's or coordinator's notifications upon logout or session expiry.
 * 
 * Strict Guarantees:
 * 1. Scope Isolation: Strictly deletes only rows belonging to the caller's verified identity.
 * 2. Non-Blocking: Guaranteed execution bounded by a strict timeout (default: 2500ms).
 *    Never throws or leaves the caller hanging if the backend or network is offline.
 * 3. Idempotency: Safe to call repeatedly during logout or session expiration cascades.
 * 4. Data Safety: Only modifies `public.notifications`; never touches registrations, payments,
 *    complaints, certificates, or student profile data.
 */
export async function cleanupSessionNotifications(
  options: CleanupSessionNotificationsOptions = {}
): Promise<CleanupSessionNotificationsResult> {
  // If an identical cleanup operation is currently executing, reuse that promise
  if (inFlightCleanupPromise) {
    return inFlightCleanupPromise;
  }

  const { token = null, timeoutMs = 2500 } = options;

  inFlightCleanupPromise = (async (): Promise<CleanupSessionNotificationsResult> => {
    // 1. Establish timeout race promise
    let timeoutId: any;
    const timeoutPromise = new Promise<CleanupSessionNotificationsResult>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve({
          success: false,
          deletedCount: 0,
          error: `Notification cleanup timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);
    });

    // 2. Perform authorized cleanup
    const executionPromise = (async (): Promise<CleanupSessionNotificationsResult> => {
      try {
        // Fast-path: Check caller context
        let userId: string | null = null;
        if (!token) {
          try {
            const { data, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw sessionError;
            userId = data?.session?.user?.id || null;
          } catch (sessionEx: any) {
            return {
              success: false,
              deletedCount: 0,
              error: sessionEx?.message || 'Failed to resolve session for cleanup',
            };
          }
          if (!userId) {
            // No active session or user ID; nothing to clean
            return { success: true, deletedCount: 0, source: 'noop' };
          }
        }

        // Strategy A: Authoritative Security-Definer RPC
        try {
          const { data, error } = await supabase.rpc('clear_user_session_notifications', {
            p_token: token || null,
          });

          if (!error && data?.success) {
            return {
              success: true,
              deletedCount: typeof data.deleted_count === 'number' ? data.deleted_count : 0,
              source: 'rpc',
            };
          }
        } catch {
          // RPC invocation threw (e.g. function not deployed yet); fall through to fallback
        }

        // Strategy B: Fallback Direct Scoped Delete (User only, coordinator requires RPC token)
        if (userId) {
          try {
            const { error: deleteError, count } = await supabase
              .from('notifications')
              .delete({ count: 'exact' })
              .eq('user_id', userId);

            if (!deleteError) {
              return {
                success: true,
                deletedCount: typeof count === 'number' ? count : 0,
                source: 'direct_delete',
              };
            }
          } catch (deleteEx) {
            return {
              success: false,
              deletedCount: 0,
              error: (deleteEx as Error)?.message || 'Direct delete failed',
            };
          }
        }

        return {
          success: false,
          deletedCount: 0,
          error: 'Failed to execute notification cleanup via RPC or direct query',
        };
      } catch (err: any) {
        return {
          success: false,
          deletedCount: 0,
          error: err?.message || 'Unexpected cleanup exception',
        };
      }
    })();

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      inFlightCleanupPromise = null;
    }
  })();

  return inFlightCleanupPromise;
}
