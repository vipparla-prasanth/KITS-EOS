import React from 'react';
import { ArrowLeft } from 'lucide-react';

export interface KitsNotFoundProps {
  /** Target path to return home (default: '/') */
  homePath?: string;
  /** Custom navigation callback (e.g. React Router navigate or state reset) */
  onNavigateHome?: () => void;
  /** Optional custom button label (default: 'GO TO HOME') */
  homeLabel?: string;
}

export function KitsNotFound({
  homePath = '/',
  onNavigateHome,
  homeLabel = 'GO TO HOME',
}: KitsNotFoundProps) {
  const handleClick = (e: React.MouseEvent) => {
    if (onNavigateHome) {
      e.preventDefault();
      onNavigateHome();
    }
  };

  return (
    <div className="min-h-[72vh] flex items-center justify-center px-4 py-12 sm:py-16 font-sans relative select-none">
      <div className="relative w-full max-w-xl mx-auto bg-white rounded-3xl border border-gray-200 shadow-2xs p-8 sm:p-12 text-center overflow-hidden">
        
        {/* Subtle Wind / Air-flow SVG Streams flowing in the background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          <svg
            className="w-full h-full opacity-60"
            viewBox="0 0 900 320"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid slice"
          >
            {/* Stream 1 */}
            <path
              d="M -80 70 C 180 48, 320 95, 520 72 S 780 50, 960 68"
              stroke="#94A3B8"
              strokeWidth="1.75"
              strokeLinecap="round"
              className="kits-wind-stream kits-wind-stream--1"
            />
            {/* Stream 2 */}
            <path
              d="M -60 135 C 140 162, 360 115, 560 142 S 740 120, 980 138"
              stroke="#94A3B8"
              strokeWidth="1.75"
              strokeLinecap="round"
              className="kits-wind-stream kits-wind-stream--2"
            />
            {/* Stream 3 */}
            <path
              d="M -100 205 C 120 178, 300 228, 500 192 S 720 218, 940 198"
              stroke="#94A3B8"
              strokeWidth="1.75"
              strokeLinecap="round"
              className="kits-wind-stream kits-wind-stream--3"
            />
            {/* Stream 4 */}
            <path
              d="M -70 265 C 160 238, 380 282, 580 248 S 760 272, 960 252"
              stroke="#94A3B8"
              strokeWidth="1.75"
              strokeLinecap="round"
              className="kits-wind-stream kits-wind-stream--4"
            />
          </svg>
        </div>

        {/* Content Container */}
        <div className="relative z-10 space-y-6 sm:space-y-8">
          
          {/* Institutional Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-wider bg-red-50 text-kits-red border border-red-100 shadow-2xs">
            <span>404 • ROUTE UNRESOLVED</span>
          </div>

          {/* 404 Numbers Display with Single Restrained Entrance Animation */}
          <div className="kits-404-entrance">
            <div className="flex items-center justify-center font-black tracking-tight leading-none text-7xl sm:text-8xl md:text-9xl gap-1 sm:gap-2 drop-shadow-xs">
              {/* First 4: Solid KITS Red */}
              <span className="text-[#C8102E]">4</span>
              
              {/* 0: Crisp White with Slate Stroke and Soft Depth Shadow */}
              <span
                className="text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.20)] drop-shadow-[0_8px_16px_rgba(0,0,0,0.08)]"
                style={{
                  WebkitTextStroke: '2.5px #64748B',
                  paintOrder: 'stroke fill',
                }}
              >
                0
              </span>
              
              {/* Second 4: Solid Akshar Blue */}
              <span className="text-[#003366]">4</span>
            </div>
          </div>

          {/* Minimal Clean Text Content */}
          <div className="space-y-2 max-w-sm mx-auto">
            <h1 className="text-lg sm:text-xl font-black text-gray-900 uppercase tracking-wider">
              PAGE NOT FOUND
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 leading-relaxed font-normal">
              The page you're looking for doesn't exist.
            </p>
          </div>

          {/* Primary Action Button: Solid KITS Red */}
          <div className="pt-2 flex justify-center">
            {onNavigateHome ? (
              <button
                type="button"
                onClick={handleClick}
                className="btn-liquid btn-primary-red px-6 py-3 rounded-xl text-xs font-black uppercase tracking-wider shadow-2xs inline-flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition"
              >
                <span className="btn-content">
                  <ArrowLeft className="h-4 w-4" />
                  <span>{homeLabel}</span>
                </span>
              </button>
            ) : (
              <a
                href={homePath}
                className="btn-liquid btn-primary-red px-6 py-3 rounded-xl text-xs font-black uppercase tracking-wider shadow-2xs inline-flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition"
              >
                <span className="btn-content">
                  <ArrowLeft className="h-4 w-4" />
                  <span>{homeLabel}</span>
                </span>
              </a>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
