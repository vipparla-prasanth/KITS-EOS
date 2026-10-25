import { useState, useId } from 'react';

// ============================================================================
// SVG TRIGONOMETRY HELPERS FOR DONUT & PIE ARCS
// ============================================================================

export function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

/**
 * Generates an SVG path string for a donut slice (arc with inner and outer radius).
 * Handles full circle (360 degrees) and degenerate single slices safely.
 */
export function describeDonutArc(
  x: number,
  y: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  const sweep = endAngle - startAngle;
  // SVG arcs fail if start and end are identical; clamp near 360 for full circle
  const isFullCircle = sweep >= 359.99;
  const effectiveEnd = isFullCircle ? startAngle + 359.99 : endAngle;

  const startOuter = polarToCartesian(x, y, outerRadius, effectiveEnd);
  const endOuter = polarToCartesian(x, y, outerRadius, startAngle);
  const startInner = polarToCartesian(x, y, innerRadius, startAngle);
  const endInner = polarToCartesian(x, y, innerRadius, effectiveEnd);

  const largeArcFlag = sweep > 180 ? '1' : '0';

  if (innerRadius <= 0) {
    // Pure Pie Chart (no hole)
    return [
      'M', x, y,
      'L', endOuter.x, endOuter.y,
      'A', outerRadius, outerRadius, 0, largeArcFlag, 1, startOuter.x, startOuter.y,
      'Z',
    ].join(' ');
  }

  return [
    'M', startOuter.x, startOuter.y,
    'A', outerRadius, outerRadius, 0, largeArcFlag, 0, endOuter.x, endOuter.y,
    'L', startInner.x, startInner.y,
    'A', innerRadius, innerRadius, 0, largeArcFlag, 1, endInner.x, endInner.y,
    'Z',
  ].join(' ');
}

// ============================================================================
// BASE DONUT CHART COMPONENT
// ============================================================================

export interface ChartSlice {
  id?: string;
  label: string;
  value: number;
  color: string;
  secondaryLabel?: string;
  isCorrect?: boolean;
}

export interface DonutChartProps {
  data: ChartSlice[];
  size?: number;
  thickness?: number;
  centerTitle?: string | number;
  centerSubtitle?: string;
  emptyLabel?: string;
  showLegend?: boolean;
  legendPosition?: 'right' | 'bottom';
  className?: string;
  ariaLabel?: string;
}

export function DonutChart({
  data,
  size = 160,
  thickness = 22,
  centerTitle,
  centerSubtitle,
  emptyLabel = 'No responses yet',
  showLegend = true,
  legendPosition = 'right',
  className = '',
  ariaLabel = 'Data distribution chart',
}: DonutChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const chartId = useId();

  const total = data.reduce((sum, d) => sum + (Number.isFinite(d.value) && d.value > 0 ? d.value : 0), 0);
  const outerRadius = size / 2 - 4;
  const innerRadius = Math.max(0, outerRadius - thickness);
  const center = size / 2;

  // Compute angles for valid positive slices
  let currentAngle = 0;
  const slicesWithAngles = data.map((item, idx) => {
    const val = Number.isFinite(item.value) && item.value > 0 ? item.value : 0;
    const percentage = total > 0 ? (val / total) * 100 : 0;
    const sliceAngle = total > 0 ? (val / total) * 360 : 0;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    return {
      ...item,
      val,
      percentage,
      startAngle,
      endAngle,
      index: idx,
    };
  });

  const activeSlice = hoveredIdx !== null ? slicesWithAngles[hoveredIdx] : null;

  return (
    <div
      className={`flex ${
        legendPosition === 'bottom' ? 'flex-col items-center gap-4' : 'flex-col sm:flex-row items-center gap-5'
      } ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      {/* SVG Donut Visualizer */}
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          className="overflow-visible select-none"
        >
          {total === 0 ? (
            // Empty State Track
            <circle
              cx={center}
              cy={center}
              r={(outerRadius + innerRadius) / 2}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth={thickness}
              strokeDasharray="4 4"
            />
          ) : (
            slicesWithAngles.map((slice) => {
              if (slice.val <= 0) return null;
              const isHovered = hoveredIdx === slice.index;
              const pathD = describeDonutArc(
                center,
                center,
                isHovered ? outerRadius + 3 : outerRadius,
                isHovered ? innerRadius - 2 : innerRadius,
                slice.startAngle,
                slice.endAngle
              );

              return (
                <path
                  key={`${chartId}-${slice.index}`}
                  d={pathD}
                  fill={slice.color}
                  className="transition-all duration-200 cursor-pointer focus:outline-none"
                  style={{
                    filter: isHovered ? 'drop-shadow(0 4px 6px rgba(0,0,0,0.15))' : 'none',
                    opacity: hoveredIdx !== null && !isHovered ? 0.6 : 1,
                  }}
                  onMouseEnter={() => setHoveredIdx(slice.index)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  onFocus={() => setHoveredIdx(slice.index)}
                  onBlur={() => setHoveredIdx(null)}
                  tabIndex={0}
                  aria-label={`${slice.label}: ${slice.val} (${slice.percentage.toFixed(1)}%)`}
                >
                  <title>{`${slice.label}: ${slice.val} (${slice.percentage.toFixed(1)}%)`}</title>
                </path>
              );
            })
          )}
        </svg>

        {/* Center Label (Displays Overall Totals or Dynamic Hovered Details) */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-2">
          {total === 0 ? (
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              {emptyLabel}
            </span>
          ) : activeSlice ? (
            <>
              <span
                className="text-lg font-black font-mono leading-tight tracking-tight"
                style={{ color: activeSlice.color }}
              >
                {activeSlice.val}
              </span>
              <span className="text-[10px] font-bold text-gray-700 leading-tight truncate max-w-[85%]">
                {activeSlice.label}
              </span>
              <span className="text-[10px] font-mono text-gray-500 font-semibold">
                {activeSlice.percentage.toFixed(1)}%
              </span>
            </>
          ) : (
            <>
              <span className="text-xl font-black text-gray-900 font-mono tracking-tight leading-none">
                {centerTitle !== undefined ? centerTitle : total}
              </span>
              {centerSubtitle && (
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mt-0.5 truncate max-w-[85%]">
                  {centerSubtitle}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Structured Legend */}
      {showLegend && (
        <div
          className={`w-full ${
            legendPosition === 'bottom'
              ? 'grid grid-cols-2 gap-2 text-xs pt-1'
              : 'flex flex-col space-y-1.5 text-xs flex-1 min-w-[150px]'
          }`}
        >
          {data.map((item, idx) => {
            const isHovered = hoveredIdx === idx;
            const pct = total > 0 ? ((item.value * 100) / total).toFixed(1) : '0.0';

            return (
              <div
                key={idx}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className={`flex items-center justify-between p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isHovered ? 'bg-gray-100/80 font-bold' : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className="flex items-center space-x-2 truncate pr-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="truncate text-xs">{item.label}</span>
                  {item.isCorrect && (
                    <span className="text-[10px] font-bold text-emerald-700 uppercase bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">
                      ✓ Correct
                    </span>
                  )}
                </div>
                <div className="text-right flex-shrink-0 font-mono text-xs">
                  <span className="font-bold text-gray-900">{item.value}</span>
                  <span className="text-gray-400 text-[11px] ml-1">({pct}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 1. ASSESSMENT & PARTICIPANT STATUS DISTRIBUTION DONUT
// ============================================================================

export interface StatusDistributionProps {
  completed: number;
  inProgress: number;
  notStarted?: number;
  terminated?: number;
  expired?: number;
  totalEligible?: number;
  title?: string;
  subtitle?: string;
  className?: string;
}

export function StatusDistributionDonut({
  completed,
  inProgress,
  notStarted = 0,
  terminated = 0,
  expired = 0,
  totalEligible,
  title = 'Candidate Participation & Status',
  subtitle = 'Live distribution across official candidate statuses',
  className = '',
}: StatusDistributionProps) {
  const terminatedTotal = terminated + expired;
  const activeEvaluated = completed + inProgress + terminatedTotal;
  const total = totalEligible && totalEligible > 0 ? totalEligible : activeEvaluated + notStarted;

  const data: ChartSlice[] = [
    {
      label: 'Submitted / Completed',
      value: completed,
      color: '#10B981', // Emerald
    },
    {
      label: 'In Progress',
      value: inProgress,
      color: '#F59E0B', // Amber
    },
    ...(notStarted > 0
      ? [
          {
            label: 'Yet to Attempt',
            value: notStarted,
            color: '#94A3B8', // Slate / Neutral
          },
        ]
      : []),
    ...(terminatedTotal > 0
      ? [
          {
            label: 'Terminated / Expired',
            value: terminatedTotal,
            color: '#C8102E', // KITS Brand Red
            secondaryLabel: `${terminated} strikes, ${expired} timeout`,
          },
        ]
      : []),
  ];

  return (
    <div className={`bg-white border border-gray-200/90 rounded-2xl p-5 shadow-sm space-y-4 ${className}`}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1">
        <div>
          <h3 className="text-sm font-bold text-[#003366] uppercase tracking-wider">{title}</h3>
          <p className="text-[11px] text-gray-500">{subtitle}</p>
        </div>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-50 text-[#003366] border border-blue-200">
          {total} Total Capacity
        </span>
      </div>

      <DonutChart
        data={data}
        size={170}
        thickness={24}
        centerTitle={total}
        centerSubtitle="Candidates"
        showLegend={true}
        legendPosition="right"
        ariaLabel="Assessment candidate status distribution chart"
      />
    </div>
  );
}

// ============================================================================
// 2. CORRECT VS. INCORRECT VS. UNANSWERED DONUT CHART
// ============================================================================

export interface AccuracyDonutProps {
  correct: number;
  incorrect: number;
  unanswered?: number;
  totalResponses?: number;
  title?: string;
  size?: number;
  compact?: boolean;
  className?: string;
}

export function AccuracyDonutChart({
  correct,
  incorrect,
  unanswered = 0,
  totalResponses,
  title,
  size = 140,
  compact = false,
  className = '',
}: AccuracyDonutProps) {
  const evaluatedTotal = correct + incorrect + unanswered;
  const total = totalResponses !== undefined ? totalResponses : evaluatedTotal;
  const accuracyPct = total > 0 ? ((correct * 100) / total).toFixed(0) : '0';

  const data: ChartSlice[] = [
    {
      label: 'Correct',
      value: correct,
      color: '#10B981', // Emerald
    },
    {
      label: 'Incorrect',
      value: incorrect,
      color: '#C8102E', // KITS Red
    },
    ...(unanswered > 0
      ? [
          {
            label: 'Unanswered',
            value: unanswered,
            color: '#94A3B8', // Slate
          },
        ]
      : []),
  ];

  if (compact) {
    return (
      <div className={`flex items-center space-x-4 ${className}`}>
        <DonutChart
          data={data}
          size={size}
          thickness={18}
          centerTitle={`${accuracyPct}%`}
          centerSubtitle="Accuracy"
          showLegend={false}
          ariaLabel="Question accuracy donut chart"
        />
        <div className="space-y-1 text-xs">
          {data.map((d, i) => (
            <div key={i} className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
              <span className="text-gray-600 font-medium">{d.label}:</span>
              <span className="font-mono font-bold text-gray-900">{d.value}</span>
              <span className="text-gray-400 text-[10px]">
                ({total > 0 ? ((d.value * 100) / total).toFixed(0) : 0}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white border border-gray-200/90 rounded-2xl p-5 shadow-sm space-y-3 ${className}`}>
      {title && (
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
            {accuracyPct}% Accuracy
          </span>
        </div>
      )}

      <DonutChart
        data={data}
        size={size}
        thickness={22}
        centerTitle={`${accuracyPct}%`}
        centerSubtitle="Accuracy"
        showLegend={true}
        legendPosition="right"
        ariaLabel="Assessment response accuracy chart"
      />
    </div>
  );
}

// ============================================================================
// 3. ANSWER OPTION DISTRIBUTION DONUT / PIE CHART (FOR MCQ)
// ============================================================================

const OPTION_COLORS = [
  '#003366', // KITS Navy Blue (Option A)
  '#0891B2', // Cyan (Option B)
  '#D97706', // Amber (Option C)
  '#7C3AED', // Violet (Option D)
  '#E11D48', // Rose (Option E)
  '#4B5563', // Slate (Option F)
];

export interface OptionDistributionProps {
  options: Array<{
    option_id: string;
    option_text: string;
    selected_count: number;
    is_correct?: boolean;
  }>;
  totalResponses: number;
  className?: string;
}

export function OptionDistributionChart({
  options,
  totalResponses,
  className = '',
}: OptionDistributionProps) {
  const chartData: ChartSlice[] = options.map((opt, idx) => {
    const letter = String.fromCharCode(65 + idx);
    const assignedColor = opt.is_correct ? '#10B981' : OPTION_COLORS[idx % OPTION_COLORS.length];

    return {
      id: opt.option_id,
      label: `Option ${letter}`,
      value: opt.selected_count,
      color: assignedColor,
      isCorrect: opt.is_correct,
      secondaryLabel: opt.option_text,
    };
  });

  return (
    <div className={`p-3.5 bg-gray-50/70 border border-gray-200/80 rounded-xl space-y-3 ${className}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-gray-700 uppercase tracking-wider text-[10px]">
          Answer Option Distribution (Proportion):
        </span>
        <span className="text-[11px] font-mono text-gray-500 font-medium">
          {totalResponses} responses logged
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        {/* Compact Option Donut Chart */}
        <DonutChart
          data={chartData}
          size={120}
          thickness={16}
          centerTitle={totalResponses}
          centerSubtitle="Answers"
          showLegend={false}
          ariaLabel="Option selection distribution donut"
        />

        {/* Option Legend with Text & Correct Indicator */}
        <div className="grid grid-cols-1 gap-1.5 w-full flex-1 text-xs">
          {options.map((opt, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const color = opt.is_correct ? '#10B981' : OPTION_COLORS[idx % OPTION_COLORS.length];
            const pct =
              totalResponses > 0
                ? ((opt.selected_count * 100) / totalResponses).toFixed(1)
                : '0.0';

            return (
              <div
                key={opt.option_id}
                className={`p-2 rounded-lg border text-xs flex items-center justify-between transition-colors ${
                  opt.is_correct
                    ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950 font-bold'
                    : 'bg-white border-gray-200 text-gray-700'
                }`}
              >
                <div className="flex items-center space-x-2 truncate pr-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-mono font-bold text-gray-500">{letter}.</span>
                  <span className="truncate">{opt.option_text}</span>
                  {opt.is_correct && (
                    <span className="text-emerald-700 text-[10px] font-black uppercase flex-shrink-0 ml-1">
                      ✓ Correct
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-gray-700 flex-shrink-0 text-right">
                  <strong>{opt.selected_count}</strong> ({pct}%)
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 4. PERFORMANCE DISTRIBUTION: DONUT (PROPORTIONS) + BARS (STUDENT COUNTS)
// ============================================================================

export interface PerformanceTier {
  label: string;
  range: string;
  count: number;
  color: string;
  description: string;
}

export interface PerformanceDistributionProps {
  students: Array<{
    academic_percentage: number;
    is_passed: boolean;
  }>;
  passingPercentage?: number;
  className?: string;
}

export function PerformanceDistributionCard({
  students,
  passingPercentage = 40,
  className = '',
}: PerformanceDistributionProps) {
  const total = students.length;

  // Group into standard academic achievement tiers
  const tier90_100 = students.filter((s) => s.academic_percentage >= 80).length;
  const tier70_89 = students.filter((s) => s.academic_percentage >= 60 && s.academic_percentage < 80).length;
  const tierPass = students.filter((s) => s.academic_percentage >= passingPercentage && s.academic_percentage < 60).length;
  const tierBelow = students.filter((s) => s.academic_percentage < passingPercentage).length;

  const tiers: PerformanceTier[] = [
    {
      label: 'Distinction (80–100%)',
      range: '80–100%',
      count: tier90_100,
      color: '#10B981', // Emerald
      description: 'Exceptional mastery',
    },
    {
      label: 'Proficient (60–79%)',
      range: '60–79%',
      count: tier70_89,
      color: '#003366', // KITS Brand Blue
      description: 'Above average understanding',
    },
    {
      label: 'Passing (40–59%)',
      range: '40–59%',
      count: tierPass,
      color: '#F59E0B', // Amber
      description: 'Satisfactory standard met',
    },
    {
      label: 'Below Cutoff (<40%)',
      range: '<40%',
      count: tierBelow,
      color: '#C8102E', // KITS Brand Red
      description: 'Needs academic remediation',
    },
  ];

  const chartData: ChartSlice[] = tiers.map((t) => ({
    label: t.label,
    value: t.count,
    color: t.color,
  }));

  const maxTierCount = Math.max(1, ...tiers.map((t) => t.count));

  return (
    <div className={`bg-white border border-gray-200/90 rounded-2xl p-6 shadow-sm space-y-5 ${className}`}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1 border-b border-gray-100 pb-3">
        <div>
          <h3 className="text-sm font-bold text-[#003366] uppercase tracking-wider">
            Score Distribution & Academic Performance
          </h3>
          <p className="text-[11px] text-gray-500">
            Proportions across achievement tiers (Donut) and student headcounts (Comparison Bars)
          </p>
        </div>
        <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-800 border border-gray-200">
          {total} Candidates Evaluated
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Left: Donut Chart showing tier proportions */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center p-2 bg-gray-50/50 rounded-xl border border-gray-100">
          <DonutChart
            data={chartData}
            size={170}
            thickness={24}
            centerTitle={total}
            centerSubtitle="Evaluated"
            showLegend={false}
            ariaLabel="Performance tier proportions donut chart"
          />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-2">
            Proportion across Score Tiers
          </span>
        </div>

        {/* Right: Comparative Horizontal Bars for exact student headcounts */}
        <div className="lg:col-span-7 space-y-3">
          {tiers.map((t, idx) => {
            const pctOfTotal = total > 0 ? ((t.count * 100) / total).toFixed(1) : '0.0';
            const barWidthPct = (t.count / maxTierCount) * 100;

            return (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                    <span className="font-bold text-gray-800">{t.label}</span>
                    <span className="text-[10px] text-gray-400 hidden sm:inline">• {t.description}</span>
                  </div>
                  <div className="font-mono text-xs text-right">
                    <strong className="text-gray-900">{t.count}</strong>
                    <span className="text-gray-500 text-[11px] ml-1">({pctOfTotal}%)</span>
                  </div>
                </div>

                {/* Horizontal Comparison Bar */}
                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-2.5 rounded-full transition-all duration-500"
                    style={{
                      width: `${barWidthPct}%`,
                      backgroundColor: t.color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
