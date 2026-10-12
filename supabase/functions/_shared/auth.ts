import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { HttpError } from "./errorHandling.ts";

export interface AuthenticatedPrincipal {
  userId: string;
  role: string;
  status: string;
  email: string;
}

export interface AuthenticatedCoordinator {
  coordinatorId: string;
  username: string;
  displayName: string;
  status: string;
  coordinatorType?: string;
  isAdminFallback?: boolean;
}

/**
 * Resolves the true application identity of a user using a raw JWT header.
 * Re-authenticates against auth.users and verifies the public.users state using the service_role key.
 */
export async function resolveIdentity(
  req: Request, 
  serviceClient: SupabaseClient
): Promise<AuthenticatedPrincipal | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  // Verify the JWT via the auth server
  const { data: { user }, error: authError } = await serviceClient.auth.getUser(token);
  
  if (authError || !user || !user.email) {
    if (authError) {
      console.warn('[auth] getUser verification failed:', authError.message);
    }
    return null;
  }

  // Fetch the canonical application role and status from public.users
  // We NEVER trust the frontend-supplied role.
  const { data: appUser, error: dbError } = await serviceClient
    .from("users")
    .select("role, status, email")
    .eq("id", user.id)
    .single();

  if (dbError || !appUser) {
    if (dbError) {
      console.warn('[auth] public.users lookup failed:', dbError.message);
    }
    return null;
  }

  return {
    userId: user.id,
    role: appUser.role,
    status: appUser.status,
    email: appUser.email
  };
}

/**
 * Ensures the user is authenticated and ACTIVE. Throws standard HttpError otherwise.
 */
export async function requireActiveUser(
  req: Request, 
  serviceClient: SupabaseClient
): Promise<AuthenticatedPrincipal> {
  const identity = await resolveIdentity(req, serviceClient);

  if (!identity) {
    throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
  }

  if (identity.status === "DEACTIVATED" || identity.status === "ANONYMIZED") {
    throw new HttpError(403, "FORBIDDEN", "Account is deactivated or suspended.");
  }

  return identity;
}

export const ADMIN_ALLOWLIST: readonly string[] = Object.freeze([
  'prasanthv865@gmail.com',
  'hruthvikmanoj4608@gmail.com',
  'saideepak4408@gmail.com',
  'nerellabhavanilakshmi@gmail.com',
  'principal@kitsakshar.ac.in',
  'qa.admin@kitsakshar.ac.in',
  'jnvsravankumar@gmail.com'
]);

/**
 * Ensures the user is authenticated, ACTIVE, and holds a specific role.
 * When requiredRole is 'ADMIN', strictly enforces the authoritative ADMIN_ALLOWLIST.
 */
export async function requireRole(
  req: Request, 
  requiredRole: 'STUDENT' | 'ADMIN', 
  serviceClient: SupabaseClient
): Promise<AuthenticatedPrincipal> {
  const identity = await requireActiveUser(req, serviceClient);

  if (identity.role !== requiredRole) {
    throw new HttpError(403, "FORBIDDEN", `Access requires ${requiredRole} role.`);
  }

  if (requiredRole === 'ADMIN') {
    const normalizedEmail = (identity.email || '').trim().toLowerCase();
    if (!ADMIN_ALLOWLIST.includes(normalizedEmail)) {
      throw new HttpError(403, "FORBIDDEN", "Unauthorized administrator identity.");
    }
  }

  return identity;
}

/**
 * Resolves coordinator identity strictly from a cryptographically secure session token
 * (in x-coordinator-token or Authorization: Bearer ctk_...) or allows active Admin JWT.
 * NEVER logs or leaks the raw token.
 */
export async function resolveCoordinatorOrAdmin(
  req: Request,
  serviceClient: SupabaseClient
): Promise<AuthenticatedCoordinator | null> {
  // 1. Check for coordinator session token in header
  let coordinatorToken: string | null = req.headers.get("x-coordinator-token");
  const authHeader = req.headers.get("Authorization");

  if (!coordinatorToken && authHeader) {
    const candidate = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (candidate.startsWith("ctk_")) {
      coordinatorToken = candidate;
    }
  }

  if (coordinatorToken) {
    // Hash token with SHA-256 for lookup
    const encoder = new TextEncoder();
    const data = encoder.encode(coordinatorToken.trim());
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { data: sessionData, error: sessionErr } = await serviceClient
      .from("coordinator_sessions")
      .select(`
        id,
        coordinator_id,
        expires_at,
        coordinators!inner (
          id,
          username,
          display_name,
          status,
          coordinator_type
        )
      `)
      .eq("token_hash", tokenHash)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (!sessionErr && sessionData && sessionData.coordinators) {
      const coord = sessionData.coordinators as any;
      if (coord.status === "ACTIVE") {
        // Touch last_active_at non-blockingly
        serviceClient
          .from("coordinator_sessions")
          .update({ last_active_at: new Date().toISOString() })
          .eq("id", sessionData.id)
          .then(() => {});

        return {
          coordinatorId: coord.id,
          username: coord.username,
          displayName: coord.display_name,
          status: coord.status,
          coordinatorType: coord.coordinator_type,
          isAdminFallback: false,
        };
      }
    }
  }

  // 2. Fallback check for Admin Supabase JWT (e.g. administrator monitoring/inspecting)
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token && !token.startsWith("ctk_") && !token.startsWith("sb_publishable_") && token !== (Deno.env.get("SUPABASE_ANON_KEY") ?? "")) {
      const { data: { user } } = await serviceClient.auth.getUser(token);
      if (user) {
        const { data: appUser } = await serviceClient
          .from("users")
          .select("role, status, email")
          .eq("id", user.id)
          .single();

        if (appUser && appUser.role === "ADMIN" && appUser.status === "ACTIVE") {
          return {
            coordinatorId: "ADMIN_OVERRIDE",
            username: appUser.email,
            displayName: "Administrator",
            status: "ACTIVE",
            isAdminFallback: true,
          };
        }
      }
    }
  }

  return null;
}
