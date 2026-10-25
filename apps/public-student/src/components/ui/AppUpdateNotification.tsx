import { useState, useEffect } from 'react';
import { 
  subscribeToAppUpdates, 
  performAppUpdate, 
  deferUpdateForSession, 
  type AppUpdateState 
} from '../../services/appUpdateService';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';

export function AppUpdateNotification() {
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAppUpdates((state) => {
      setUpdateState(state);
    });

    return () => unsubscribe();
  }, []);

  if (!updateState || !updateState.hasUpdate || updateState.isDeferred) {
    return null;
  }

  const handleUpdateNow = async () => {
    await performAppUpdate();
  };

  const handleLater = () => {
    deferUpdateForSession(updateState?.latestBuildId);
  };

  return (
    <div 
      className="fixed bottom-4 right-4 left-4 sm:left-auto sm:right-6 sm:bottom-6 z-50 sm:max-w-md animate-in slide-in-from-bottom-5 duration-300 pointer-events-auto"
      role="region"
      aria-label="Application update available"
    >
      <div className="bg-white/95 backdrop-blur-md border border-blue-200 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-2xl shadow-blue-900/10 flex flex-col gap-3">
        {/* Header with Sparkle Icon and Title */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-2xl bg-blue-50 text-kits-blue border border-blue-100 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-kits-blue animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs sm:text-sm font-black text-gray-900 leading-snug">
                A new version of KITS-EOS is available.
              </h3>
              {updateState.latestVersion && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase bg-blue-100 text-kits-blue">
                  v{updateState.latestVersion}
                </span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-gray-600 mt-1 leading-relaxed">
              New improvements are ready. Update now to continue with the latest version.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-gray-100">
          <button
            type="button"
            onClick={handleLater}
            disabled={updateState.isUpdating}
            className="px-3.5 py-2 rounded-xl text-xs font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition cursor-pointer disabled:opacity-50"
          >
            Later
          </button>

          <button
            type="button"
            onClick={handleUpdateNow}
            disabled={updateState.isUpdating}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-kits-blue text-white hover:bg-blue-800 active:scale-95 transition shadow-2xs cursor-pointer disabled:opacity-60"
          >
            {updateState.isUpdating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Updating...</span>
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Update Now</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
