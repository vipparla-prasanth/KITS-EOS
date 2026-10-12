import { createClient } from '@supabase/supabase-js';

const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;


if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase URL or Anon Key is missing. Check your environment variables.");
}


import { SUPABASE_AUTH_STORAGE_KEY } from '../utils/sessionLifecycle';

// Institutional browser authentication client with robust persistence across reloads, redirects, and tabs
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export interface AdminFunctionInvokeOptions {
  body?: any;
  headers?: Record<string, string>;
  method?: 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE';
}

/**
 * Authoritative invoker for Admin-only Edge Functions.
 * Follows KITS-EOS Authentication Standards:
 * 1. Checks active Supabase session.
 * 2. Pre-emptively refreshes if expired or expiring within 30s.
 * 3. Sends Authorization: Bearer <fresh_access_token>.
 * 4. Step 8 Retry Behavior: If transient 401 received, refreshes session ONCE and retries ONCE.
 * 5. Returns parsed error message if still unauthorized.
 */
export async function invokeAdminEdgeFunction<T = any>(
  functionName: string,
  options: AdminFunctionInvokeOptions = {}
): Promise<{ data: T | null; error: any }> {
  let { data: sessionData } = await supabase.auth.getSession();
  let session = sessionData?.session;

  const nowSec = Math.floor(Date.now() / 1000);
  const isExpiring = !session?.access_token || (session.expires_at && session.expires_at <= nowSec + 30);

  if (isExpiring) {
    const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
    if (!refreshErr && refreshData?.session) {
      session = refreshData.session;
    }
  }

  if (!session?.access_token) {
    return {
      data: null,
      error: new Error('Your administrative session has expired. Please sign in again.'),
    };
  }

  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${session.access_token}`,
  };

  let res = await supabase.functions.invoke<T>(functionName, {
    ...options,
    headers,
  });

  // Step 8: Retry behavior on transient 401
  const is401 = res.error && (
    (res.error as any).status === 401 ||
    (res.error as any).context?.status === 401 ||
    res.error.message?.includes('401') ||
    res.error.message?.includes('Authentication required')
  );

  if (is401) {
    console.warn(`[invokeAdminEdgeFunction] Transient 401 on ${functionName}. Refreshing session and retrying once...`);
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError && refreshed?.session?.access_token) {
      const retryHeaders = {
        ...(options.headers || {}),
        Authorization: `Bearer ${refreshed.session.access_token}`,
      };
      res = await supabase.functions.invoke<T>(functionName, {
        ...options,
        headers: retryHeaders,
      });
    }
  }

  // Extract human-readable error message from response body if Edge Function returned non-2xx
  if (res.error && (res.error as any).context && typeof (res.error as any).context.json === 'function') {
    try {
      const errBody = await (res.error as any).context.clone().json();
      if (errBody?.error || errBody?.message) {
        res.error.message = errBody.error || errBody.message;
      }
    } catch {
      // Body is not JSON or already consumed; maintain existing error message
    }
  }

  return res;
}

