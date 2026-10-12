/**
 * Authoritative Cross-Origin Resource Sharing (CORS) Configuration
 * 
 * Strict Whitelist Policy:
 * - Allows ONLY explicitly approved production Firebase Hosting origins.
 * - Allows ONLY strictly required localhost development origins.
 * - NEVER reflects arbitrary Origin headers.
 * - Omits 'Access-Control-Allow-Origin' for unapproved origins so browsers reject cross-origin access.
 */

const APPROVED_ORIGINS: readonly string[] = Object.freeze([
  // Production Frontend Applications (Firebase Hosting)
  'https://kits-akshar-eos.web.app',
  'https://kits-akshar-eos.firebaseapp.com',
  'https://kitsakshar-eos-central.web.app',
  'https://kitsakshar-eos-central.firebaseapp.com',
  'https://kits-akshar-eos-fallback.web.app',
  'https://kits-akshar-eos-fallback.firebaseapp.com',

  // Authorized Localhost Development Environments
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:3000',
]);

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  const normalized = origin.trim().replace(/\/+$/, '');
  if (APPROVED_ORIGINS.includes(normalized)) return true;

  // Optional dynamic override via Deno environment variable
  const envOrigins = (globalThis as any).Deno?.env?.get('ALLOWED_ORIGINS');
  if (envOrigins) {
    const list = envOrigins.split(',').map((o: string) => o.trim().replace(/\/+$/, ''));
    if (list.includes(normalized)) return true;
  }
  return false;
}

export const getCorsHeaders = (req: Request): Record<string, string> => {
  const origin = req.headers.get('Origin');
  const allowed = isAllowedOrigin(origin);

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-coordinator-token',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Vary': 'Origin',
  };

  // Only return Access-Control-Allow-Origin if origin is explicitly in the approved list
  if (allowed && origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
};
