export function LoadingState({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] w-full p-12 space-y-4">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kits-red"></div>
      <p className="text-sm font-semibold text-gray-500">{message}</p>
    </div>
  );
}
