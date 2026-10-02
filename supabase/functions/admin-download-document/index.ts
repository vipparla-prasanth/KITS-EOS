import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-coordinator-token',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
  };
}

function handleError(error: unknown, corsHeaders: Record<string, string>) {
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (error instanceof HttpError) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: error.code, message: error.message }
      }),
      { status: error.statusCode, headers }
    );
  }
  console.error("Server Error:", error);
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: (error as any)?.message || "An unexpected error occurred." }
    }),
    { status: 500, headers }
  );
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    let document_id: string | null = null;
    let coordinator_id: string | null = null;
    let mode: string = 'view'; // 'view' | 'download'

    if (req.method === 'POST') {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
      }
      document_id = body.document_id;
      coordinator_id = body.coordinator_id;
      mode = body.mode || 'view';
    } else if (req.method === 'GET') {
      const url = new URL(req.url);
      document_id = url.searchParams.get('document_id');
      coordinator_id = url.searchParams.get('coordinator_id');
      mode = url.searchParams.get('mode') || 'view';
    } else {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    }

    if (!document_id || typeof document_id !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'document_id is required');
    }

    // 1. Fetch document metadata
    const { data: doc, error: docErr } = await supabaseClient
      .from('documents')
      .select('id, owner_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, uploaded_at')
      .eq('id', document_id)
      .single();

    if (docErr || !doc) {
      throw new HttpError(404, 'NOT_FOUND', 'Document record not found');
    }

    // 2. Determine authorization
    let isAuthorized = false;

    // Check caller identity and authorization cryptographically
    let coordinatorToken: string | null = req.headers.get("x-coordinator-token");
    const authHeader = req.headers.get("Authorization");
    if (!coordinatorToken && authHeader) {
      const candidate = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (candidate.startsWith("ctk_")) {
        coordinatorToken = candidate;
      }
    }

    if (coordinatorToken) {
      const encoder = new TextEncoder();
      const data = encoder.encode(coordinatorToken.trim());
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const tokenHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const { data: sessionData, error: sessionErr } = await supabaseClient
        .from("coordinator_sessions")
        .select(`
          coordinator_id,
          expires_at,
          coordinators!inner (
            id,
            status
          )
        `)
        .eq("token_hash", tokenHash)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (!sessionErr && sessionData && (sessionData.coordinators as any)?.status === "ACTIVE") {
        let subEventId: string | null = null;
        if (doc.entity_type === 'REGISTRATION') {
          const { data: reg } = await supabaseClient
            .from('registrations')
            .select('sub_event_id')
            .eq('id', doc.entity_id)
            .single();
          subEventId = reg?.sub_event_id || null;
        }

        if (subEventId) {
          const { data: assignment } = await supabaseClient
            .from('coordinator_assignments')
            .select('id')
            .eq('coordinator_id', sessionData.coordinator_id)
            .eq('sub_event_id', subEventId)
            .maybeSingle();

          if (assignment) {
            isAuthorized = true;
          }
        }
      }
    } else if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token && !token.startsWith("ctk_") && token !== (Deno.env.get('SUPABASE_ANON_KEY') ?? '')) {
        const { data: { user } } = await supabaseClient.auth.getUser(token);
        if (user) {
          const { data: appUser } = await supabaseClient
            .from("users")
            .select("role, status")
            .eq("id", user.id)
            .single();

          if (appUser && appUser.role === 'ADMIN' && appUser.status === 'ACTIVE') {
            isAuthorized = true;
          } else if (doc.owner_id === user.id) {
            isAuthorized = true;
          }
        }
      }
    }

    if (!isAuthorized) {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied: You are not authorized to view or download this document.');
    }

    // 3. Generate signed URL for the document (valid for 300 seconds)
    let bucketName = 'documents';
    let signedUrl: string | null = null;

    const { data: signed1, error: signErr1 } = await supabaseClient
      .storage
      .from('documents')
      .createSignedUrl(doc.storage_path, 300, {
        download: mode === 'download' ? doc.file_name : false,
      });

    if (!signErr1 && signed1?.signedUrl) {
      signedUrl = signed1.signedUrl;
    } else {
      const { data: signed2, error: signErr2 } = await supabaseClient
        .storage
        .from('events')
        .createSignedUrl(doc.storage_path, 300, {
          download: mode === 'download' ? doc.file_name : false,
        });
      if (!signErr2 && signed2?.signedUrl) {
        signedUrl = signed2.signedUrl;
        bucketName = 'events';
      }
    }

    if (!signedUrl) {
      throw new HttpError(500, 'STORAGE_ERROR', 'Failed to generate signed download URL for file.');
    }

    return new Response(JSON.stringify({
      success: true,
      document_id: doc.id,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      size_bytes: doc.size_bytes,
      uploaded_at: doc.uploaded_at,
      signed_url: signedUrl,
      mode,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
