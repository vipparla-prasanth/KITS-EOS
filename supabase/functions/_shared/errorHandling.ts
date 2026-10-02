// Shared Server-Side Error Handling Utilities
// Note: This is a placeholder for Phase 0.

export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export const handleError = (error: unknown, corsHeaders?: Record<string, string>) => {
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  
  if (error instanceof HttpError) {
    return new Response(
      JSON.stringify({
        success: false,
        code: error.code,
        message: error.message,
        error: {
          code: error.code,
          message: error.message
        }
      }),
      { status: error.statusCode, headers }
    );
  }

  console.error("Server Error:", error);
  
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred."
      }
    }),
    { status: 500, headers }
  );
};
