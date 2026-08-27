import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { HttpError } from "./errorHandling.ts";

export interface AuthenticatedPrincipal {
  userId: string;
  role: string;
  status: string;
  email: string;
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

  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;

  // Verify the JWT via the auth server
  const { data: { user }, error: authError } = await serviceClient.auth.getUser(token);
  
  if (authError || !user || !user.email) {
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

/**
 * Ensures the user is authenticated, ACTIVE, and holds a specific role.
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

  return identity;
}
