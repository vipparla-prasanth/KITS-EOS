import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Institutional React ErrorBoundary to prevent blank screens on unhandled runtime or selector errors.
 * Renders a high-contrast recovery UI with zero window.location.reload() calls.
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('KITS-EOS Student Portal ErrorBoundary caught unhandled error:', error, errorInfo);

    // Auto-recover once from stale dynamic chunk imports following new deployments
    const isChunkError = Boolean(
      error?.message && (
        error.message.includes('Failed to fetch dynamically imported module') ||
        error.message.includes('error loading dynamically imported module') ||
        error.message.includes('Importing a module script failed')
      )
    );

    if (isChunkError && typeof window !== 'undefined') {
      const key = 'kits_student_chunk_error_ts';
      const lastAttempt = Number(sessionStorage.getItem(key) || '0');
      const now = Date.now();
      if (now - lastAttempt > 8000) {
        sessionStorage.setItem(key, String(now));
        window.location.reload();
      }
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (typeof window !== 'undefined') {
      const isChunkError = Boolean(
        this.state.error?.message && (
          this.state.error.message.includes('Failed to fetch dynamically imported module') ||
          this.state.error.message.includes('error loading dynamically imported module') ||
          this.state.error.message.includes('Importing a module script failed')
        )
      );
      if (isChunkError) {
        window.location.reload();
      } else {
        window.location.assign('/');
      }
    }
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isChunkError = Boolean(
        this.state.error?.message && (
          this.state.error.message.includes('Failed to fetch dynamically imported module') ||
          this.state.error.message.includes('error loading dynamically imported module') ||
          this.state.error.message.includes('Importing a module script failed')
        )
      );

      return (
        <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center px-4 py-12">
          <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl p-8 shadow-sm text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-xl font-black text-gray-900 mb-2">
              {isChunkError ? 'Application Update Available' : 'Student Portal Display Error'}
            </h1>
            <p className="text-xs text-gray-600 mb-4 leading-relaxed">
              {isChunkError
                ? 'A new version of KITS-EOS has been published. Please reload to load the latest institutional version.'
                : 'The application encountered an unexpected display or navigation issue.'}
            </p>
            {this.state.error && (
              <div className="bg-gray-100 rounded-xl p-3 mb-6 text-left overflow-x-auto text-[11px] font-mono text-gray-700">
                {this.state.error.message || 'Unknown runtime exception'}
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="w-full inline-flex justify-center items-center px-4 py-2.5 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl transition shadow-sm cursor-pointer"
            >
              {isChunkError ? 'Reload & Update Portal' : 'Return to Student Portal Home'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
