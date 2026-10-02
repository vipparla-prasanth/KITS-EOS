// Shared API response contracts

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// Standard HTTP Error Codes that KITS-EOS will use
export const ApiErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',           // 400
  UNAUTHORIZED: 'UNAUTHORIZED',         // 401
  FORBIDDEN: 'FORBIDDEN',               // 403
  NOT_FOUND: 'NOT_FOUND',               // 404
  CONFLICT: 'CONFLICT',                 // 409
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS', // 429
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR' // 500
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
