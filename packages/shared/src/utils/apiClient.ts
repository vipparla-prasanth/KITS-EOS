import { ApiResponse, ApiErrorCode } from '../types/api';

/**
 * Reusable API client pattern for communicating with Supabase Edge Functions.
 * Note: No business endpoints are implemented here in Phase 0.
 * This merely establishes the architecture.
 */

export class ApiClient {
  private static async fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 10000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(id);
    }
  }

  static async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    try {
      const response = await this.fetchWithTimeout(endpoint, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        }
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: data.error?.code || ApiErrorCode.INTERNAL_SERVER_ERROR,
            message: data.error?.message || 'An unexpected error occurred.',
            details: data.error?.details
          }
        };
      }

      return {
        success: true,
        data: data.data as T
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
         return {
          success: false,
          error: {
            code: ApiErrorCode.INTERNAL_SERVER_ERROR,
            message: 'Request timed out.'
          }
        };
      }

      return {
        success: false,
        error: {
          code: ApiErrorCode.INTERNAL_SERVER_ERROR,
          message: 'Network error or unable to reach the server.'
        }
      };
    }
  }
}
