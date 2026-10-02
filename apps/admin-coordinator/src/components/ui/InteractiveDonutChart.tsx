import React, { useState, useMemo } from 'react';

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color: string;
  unit?: string;
  secondaryLabel?: string;
}

export interface InteractiveDonutChartProps {
  data: DonutSlice[];
  centerPrimary?: string | number;
  centerSecondary?: string;
  emptyMessage?: string;
  className?: string;
  showLegend?: boolean;
  onSliceClick?: (slice: DonutSlice) => void;
  height?: number;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInRadians: number) {
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

function createDonutArcPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startAngle: number,
  endAngle: number
) {
  const p1 = polarToCartesian(cx, cy, rOuter, startAngle);
  const p2 = polarToCartesian(cx, cy, rOuter, endAngle);
  const p3 = polarToCartesian(cx, cy, rInner, endAngle);
  const p4 = polarToCartesian(cx, cy, rInner, startAngle);
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArcFlag} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArcFlag} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function InteractiveDonutChart({
  data,
  centerPrimary,
  centerSecondary,
  emptyMessage = 'No data for the selected filters.',
  className = '',
  showLegend = true,
  onSliceClick,
}: InteractiveDonutChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  // Filter out toggled-off slices
  const activeSlices = useMemo(() => {
    return data.filter((s) => !hiddenIds.has(s.id));
  }, [data, hiddenIds]);

  const total = useMemo(() => {
    return activeSlices.reduce((acc, curr) => acc + (Math.max(curr.value, 0) || 0), 0);
  }, [activeSlices]);

  const nonZeroSlices = useMemo(() => {
    return activeSlices.filter((s) => s.value > 0);
  }, [activeSlices]);

  // Handle toggling slice visibility from legend
  const handleToggleSlice = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // Prevent hiding everything
        if (next.size + 1 < data.length) {
          next.add(id);
        }
      }
      return next;
    });
  };

  const cx = 130;
  const cy = 130;
  const defaultOuterRadius = 96;
  const hoveredOuterRadius = 104;
  const innerRadius = 64;

  // Compute slice angles
  const sliceAngles = useMemo(() => {
    if (total <= 0 || nonZeroSlices.length === 0) return [];

    let currentAngle = -Math.PI / 2; // Start from top (12 o'clock)
    const gap = nonZeroSlices.length > 1 ? 0.038 : 0; // Separation gap in radians (~2.2 degrees)

    return nonZeroSlices.map((slice) => {
      const span = (slice.value / total) * 2 * Math.PI;
      const start = currentAngle;
      const end = currentAngle + span;
      currentAngle = end;

      // Apply gap only if span is comfortably larger than gap
      const effectiveGap = span > gap * 2 ? gap : 0;
      const pathStart = start + effectiveGap / 2;
      const pathEnd = end - effectiveGap / 2;

      return {
        slice,
        startAngle: pathStart,
        endAngle: pathEnd,
        span,
        percentage: Math.round((slice.value / total) * 100),
      };
    });
  }, [nonZeroSlices, total]);

  // Hovered item details
  const hoveredItem = hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < nonZeroSlices.length
    ? nonZeroSlices[hoveredIndex]
    : null;

  const hoveredPercentage = hoveredItem && total > 0
    ? Math.round((hoveredItem.value / total) * 100)
    : null;

  // Empty state if no data or total === 0
  if (total === 0 || data.length === 0 || nonZeroSlices.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-6 px-4 text-center ${className}`}>
        <div className="relative w-44 h-44 sm:w-48 sm:h-48 mx-auto flex items-center justify-center">
          <svg viewBox="0 0 260 260" className="w-full h-full">
            <circle
              cx={cx}
              cy={cy}
              r={(defaultOuterRadius + innerRadius) / 2}
              fill="none"
              stroke="#F1F5F9"
              strokeWidth={defaultOuterRadius - innerRadius}
            />
            <circle
              cx={cx}
              cy={cy}
              r={defaultOuterRadius}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <circle
              cx={cx}
              cy={cy}
              r={innerRadius}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth={1}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4">
            <span className="text-xl font-black text-gray-400 font-mono">0</span>
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">
              No Data
            </span>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3 max-w-xs leading-relaxed font-medium">
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-between w-full space-y-4 ${className}`}>
      {/* Chart Canvas & Hover Tooltip */}
      <div className="relative w-full max-w-[230px] sm:max-w-[240px] aspect-square mx-auto flex items-center justify-center">
        <svg
          viewBox="0 0 260 260"
          className="w-full h-full select-none overflow-visible"
          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.03))' }}
        >
          {/* Base background ring */}
          <circle
            cx={cx}
            cy={cy}
            r={(defaultOuterRadius + innerRadius) / 2}
            fill="none"
            stroke="#F8FAFC"
            strokeWidth={defaultOuterRadius - innerRadius}
          />

          {/* Slices */}
          {nonZeroSlices.length === 1 ? (
            // Single 100% full ring
            <g
              className="cursor-pointer transition-all duration-200"
              onMouseEnter={() => setHoveredIndex(0)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={() => onSliceClick?.(nonZeroSlices[0])}
            >
              <path
                d={`M ${cx} ${cy - (hoveredIndex === 0 ? hoveredOuterRadius : defaultOuterRadius)}
                    A ${hoveredIndex === 0 ? hoveredOuterRadius : defaultOuterRadius} ${hoveredIndex === 0 ? hoveredOuterRadius : defaultOuterRadius} 0 1 1 ${cx} ${cy + (hoveredIndex === 0 ? hoveredOuterRadius : defaultOuterRadius)}
                    A ${hoveredIndex === 0 ? hoveredOuterRadius : defaultOuterRadius} ${hoveredIndex === 0 ? hoveredOuterRadius : defaultOuterRadius} 0 1 1 ${cx} ${cy - (hoveredIndex === 0 ? hoveredOuterRadius : defaultOuterRadius)}
                    M ${cx} ${cy - innerRadius}
                    A ${innerRadius} ${innerRadius} 0 1 0 ${cx} ${cy + innerRadius}
                    A ${innerRadius} ${innerRadius} 0 1 0 ${cx} ${cy - innerRadius}
                    Z`}
                fill={nonZeroSlices[0].color}
                fillRule="evenodd"
                stroke="#FFFFFF"
                strokeWidth={3}
                style={{
                  filter: hoveredIndex === 0 ? 'brightness(1.06)' : undefined,
                  transition: 'all 180ms ease-out',
                }}
              />
            </g>
          ) : (
            // Multiple slices
            sliceAngles.map((item, idx) => {
              const isHovered = hoveredIndex === idx;
              const rOut = isHovered ? hoveredOuterRadius : defaultOuterRadius;
              const pathD = createDonutArcPath(cx, cy, innerRadius, rOut, item.startAngle, item.endAngle);

              return (
                <g
                  key={item.slice.id}
                  className="cursor-pointer transition-all duration-200"
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => onSliceClick?.(item.slice)}
                >
                  <path
                    d={pathD}
                    fill={item.slice.color}
                    stroke="#FFFFFF"
                    strokeWidth={3}
                    strokeLinejoin="round"
                    style={{
                      opacity: hoveredIndex === null || isHovered ? 1 : 0.65,
                      filter: isHovered ? 'brightness(1.08) drop-shadow(0 2px 5px rgba(0,0,0,0.12))' : undefined,
                      transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                </g>
              );
            })
          )}

          {/* Center Summary Text (Accessible & High Contrast) */}
          <g className="pointer-events-none">
            {hoveredItem ? (
              <>
                <text
                  x={cx}
                  y={cy - 6}
                  textAnchor="middle"
                  className="text-2xl sm:text-3xl font-black fill-gray-900 font-mono tracking-tight"
                  style={{ fontSize: '26px', fontWeight: 900 }}
                >
                  {hoveredPercentage}%
                </text>
                <text
                  x={cx}
                  y={cy + 16}
                  textAnchor="middle"
                  className="text-[11px] font-bold fill-gray-600 uppercase tracking-wider"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {hoveredItem.label.length > 14 ? `${hoveredItem.label.slice(0, 12)}…` : hoveredItem.label}
                </text>
                <text
                  x={cx}
                  y={cy + 30}
                  textAnchor="middle"
                  className="text-[10px] font-medium fill-gray-400 font-mono"
                  style={{ fontSize: '10px' }}
                >
                  {hoveredItem.value} {hoveredItem.unit || ''}
                </text>
              </>
            ) : (
              <>
                <text
                  x={cx}
                  y={cy - 4}
                  textAnchor="middle"
                  className="text-xl sm:text-2xl font-black fill-gray-900 font-mono tracking-tight"
                  style={{ fontSize: '24px', fontWeight: 900 }}
                >
                  {centerPrimary !== undefined ? centerPrimary : total}
                </text>
                <text
                  x={cx}
                  y={cy + 16}
                  textAnchor="middle"
                  className="text-[11px] font-bold fill-gray-500 uppercase tracking-wider"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {centerSecondary || 'Total'}
                </text>
              </>
            )}
          </g>
        </svg>

        {/* Floating Tooltip Indicator on hover */}
        {hoveredItem && (
          <div 
            className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gray-900/95 backdrop-blur-xs text-white text-[11px] px-3 py-1.5 rounded-lg shadow-lg pointer-events-none flex items-center gap-2 whitespace-nowrap z-20 transition-all duration-150 animate-in fade-in zoom-in-95"
            style={{ borderLeft: `3px solid ${hoveredItem.color}` }}
          >
            <span className="font-bold">{hoveredItem.label}:</span>
            <span className="font-mono font-bold text-gray-100">
              {hoveredItem.value} {hoveredItem.unit || ''}
            </span>
            <span className="font-mono text-emerald-400 font-black">
              ({hoveredPercentage}%)
            </span>
          </div>
        )}
      </div>

      {/* Accessible Interactive Legend */}
      {showLegend && data.length > 0 && (
        <div className="w-full pt-2 border-t border-gray-100/80">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {data.map((slice) => {
              const isHidden = hiddenIds.has(slice.id);
              const sliceNonZeroIdx = nonZeroSlices.findIndex((s) => s.id === slice.id);
              const isHovered = sliceNonZeroIdx !== -1 && hoveredIndex === sliceNonZeroIdx;
              const pct = total > 0 && !isHidden ? Math.round((slice.value / total) * 100) : 0;

              return (
                <div
                  key={slice.id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleToggleSlice(slice.id, e)}
                  onMouseEnter={() => {
                    if (sliceNonZeroIdx !== -1) setHoveredIndex(sliceNonZeroIdx);
                  }}
                  onMouseLeave={() => setHoveredIndex(null)}
                  title={`Click to ${isHidden ? 'show' : 'hide'} ${slice.label}`}
                  className={`flex items-center justify-between p-1.5 rounded-lg transition-all duration-150 cursor-pointer select-none ${
                    isHovered ? 'bg-gray-100/90 ring-1 ring-gray-300' : 'hover:bg-gray-50'
                  } ${isHidden ? 'opacity-40 grayscale' : ''}`}
                >
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0 transition-transform"
                      style={{
                        backgroundColor: slice.color,
                        transform: isHovered ? 'scale(1.25)' : 'scale(1)',
                      }}
                    />
                    <span className="font-bold text-gray-700 truncate text-[11px]">
                      {slice.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px]">
                    <span className="font-black text-gray-900">
                      {slice.value}
                    </span>
                    <span className="text-[10px] text-gray-400 font-semibold">
                      ({pct}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
