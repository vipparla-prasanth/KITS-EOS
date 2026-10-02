export const getCorsHeaders = (req: Request): Record<string, string> => {
  const origin = req.headers.get('Origin');
  
  // Strict allowlist pattern
  const defaultOrigins = 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:5174';
  const allowedOriginsEnv = (globalThis as any).Deno?.env?.get('ALLOWED_ORIGINS') || defaultOrigins;
  const allowedOrigins = allowedOriginsEnv.split(',').map((o: string) => o.trim());
  
  let allowOrigin = origin || '*';
  if (origin && (allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
    allowOrigin = origin;
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-coordinator-token',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
  };
};
