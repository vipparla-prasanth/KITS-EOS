import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * KITS-EOS Administrator Authentication Edge Function - PERMANENTLY DISABLED
 * 
 * In accordance with KITS-EOS Authoritative Authentication Rules:
 * Administrators must authenticate via Google Workspace SSO exclusively.
 * Password-based / username-based Administrator login is strictly disabled.
 */
serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "OPTIONS, POST"
      }
    });
  }

  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: "ADMIN_PASSWORD_LOGIN_DISABLED",
        message: "Password-based Administrator authentication is permanently disabled. Administrators must authenticate using Google Workspace SSO exclusively."
      }
    }),
    {
      status: 410,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
});
