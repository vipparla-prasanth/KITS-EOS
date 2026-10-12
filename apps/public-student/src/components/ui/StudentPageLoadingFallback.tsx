export function StudentPageLoadingFallback({ 
  message = 'Loading KITS Student Portal...' 
}: { 
  message?: string 
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="flex flex-col items-center space-y-4">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-kits-red border-t-transparent"></div>
        <p className="text-xs font-semibold text-gray-500 tracking-wider uppercase">
          {message}
        </p>
      </div>
    </div>
  );
}
