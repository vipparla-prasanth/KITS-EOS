/**
 * Institutional OAuth Redirect Utility
 * Dynamically resolves the OAuth redirect destination from the browser's active runtime origin.
 * 
 * Strict Architecture Rules:
 * - ZERO hardcoded hostnames (no localhost, 127.0.0.1, or static IPs)
 * - ZERO hardcoded ports (no 5173, 5174, 3000, etc.)
 * - ZERO hardcoded production domains
 * - Safely handles non-browser environments (SSR / test runners)
 */

export interface DynamicRedirectOptions {
  targetPath?: string;
  defaultFallback?: string;
}

/**
 * Returns the fully-qualified redirect URL based on the runtime browser origin.
 * Preserves the current protocol (http/https), hostname/LAN IP, and port.
 * 
 * @param targetPath Path to append to the origin (e.g. '/admin')
 * @returns Fully qualified URL (dynamically composed of runtime origin + target path)
 */
export function getDynamicOAuthRedirectUrl(targetPath: string = '/admin'): string {
  if (typeof window === 'undefined' || !window.location) {
    const cleanPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
    return cleanPath;
  }

  // Derive origin from browser runtime (origin = protocol + '//' + host)
  // host includes both hostname and port when non-standard
  const origin = window.location.origin 
    ? window.location.origin 
    : `${window.location.protocol}//${window.location.host}`;

  const cleanOrigin = origin.replace(/\/+$/, '');
  const cleanPath = targetPath 
    ? (targetPath.startsWith('/') ? targetPath : `/${targetPath}`)
    : '';

  return `${cleanOrigin}${cleanPath}`;
}
