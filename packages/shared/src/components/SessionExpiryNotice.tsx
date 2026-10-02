import { useEffect, useState } from 'react';
import { onSessionWarning } from '../utils/sessionLifecycle';

/**
 * SessionExpiryNotice
 * 
 * Displays an institutional security alert 30 seconds prior to 15-minute expiration.
 * In accordance with absolute 15-minute policy:
 * - Contains NO extend button or "stay logged in" control.
 * - Informs the user to complete or save any immediate work.
 */
export function SessionExpiryNotice() {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(30);

  useEffect(() => {
    let countdownInterval: any = null;

    const unsubscribe = onSessionWarning((isWarning, remainingMs) => {
      setShowWarning(isWarning);
      if (isWarning) {
        setSecondsRemaining(Math.max(1, Math.round(remainingMs / 1000)));

        clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
          setSecondsRemaining((prev) => {
            if (prev <= 1) {
              clearInterval(countdownInterval);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        clearInterval(countdownInterval);
      }
    });

    return () => {
      unsubscribe();
      clearInterval(countdownInterval);
    };
  }, []);

  if (!showWarning || secondsRemaining <= 0) return null;

  return (
    <div 
      role="alert" 
      aria-live="assertive"
      className="fixed top-4 right-4 z-50 max-w-sm w-full bg-amber-900/95 text-white p-4 rounded-2xl shadow-2xl border border-amber-500/40 backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-top-4 pointer-events-auto"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 bg-amber-500/20 text-amber-300 rounded-xl shrink-0 mt-0.5">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-black uppercase tracking-wider text-amber-200">
            Session Expiring Soon
          </h4>
          <p className="text-xs text-amber-100/90 mt-1 leading-relaxed">
            Your institutional session will expire in <span className="font-bold text-white tabular-nums">{secondsRemaining}s</span>. For institutional security, please conclude and save any pending actions.
          </p>
        </div>
      </div>
    </div>
  );
}
