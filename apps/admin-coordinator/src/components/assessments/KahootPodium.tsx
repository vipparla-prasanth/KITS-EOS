import { useState } from 'react';
import {
  Trophy,
  Medal,
  Sparkles,
  Zap,
  Target,
  RotateCcw,
  Award,
  Crown,
} from 'lucide-react';

export interface PodiumEntry {
  rank: number;
  student_name: string;
  score: number;
  question_score?: number;
  eos_points?: number;
  speed_bonus_score?: number;
  status?: string;
  submitted_at?: string | null;
}

interface KahootPodiumProps {
  entries: PodiumEntry[];
  isFinalized?: boolean;
  onReplayAnimation?: () => void;
}

export function KahootPodium({
  entries,
  isFinalized = false,
}: KahootPodiumProps) {
  const [animationKey, setAnimationKey] = useState<number>(0);

  const handleReplay = () => {
    setAnimationKey((prev) => prev + 1);
  };

  if (!entries || entries.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-gray-200 p-12 text-center shadow-sm">
        <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto text-amber-500 mb-4 border border-amber-200">
          <Trophy className="w-8 h-8" />
        </div>
        <h4 className="text-base font-bold text-gray-900">Final Podium Awaiting Results</h4>
        <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
          Once candidate examinations are completed and finalized, the top three performers will be revealed on this podium.
        </p>
      </div>
    );
  }

  // Identify top 3 candidates
  const first = entries[0] || null;
  const second = entries[1] || null;
  const third = entries[2] || null;

  // Check for ties in top 3
  const isTie1_2 = first && second && first.score === second.score;
  const isTie2_3 = second && third && second.score === third.score;

  // Remaining participants for ranks 4+
  const runnersUp = entries.slice(3);

  return (
    <div className="space-y-8" key={animationKey}>
      {/* Header with status badge & animation replay trigger */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-gradient-to-r from-gray-900 via-[#003366] to-gray-900 text-white p-5 rounded-3xl shadow-lg border border-gray-800">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-amber-400/20 text-amber-300 rounded-lg border border-amber-400/30">
              <Crown className="w-4 h-4 text-amber-400" />
            </span>
            <h3 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              <span>{isFinalized ? 'Official Final Podium' : 'Live Podium Projection'}</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                {isFinalized ? 'Finalized' : 'Live Host'}
              </span>
            </h3>
          </div>
          <p className="text-xs text-gray-300 mt-1">
            Visual hierarchy honoring top performers based on Question Points and EOS Speed Bonus.
          </p>
        </div>

        <button
          onClick={handleReplay}
          className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition border border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          title="Replay reveal animation"
        >
          <RotateCcw className="w-3.5 h-3.5 text-amber-300" />
          <span>Replay Reveal</span>
        </button>
      </div>

      {/* Podium Stage Container */}
      <div className="relative pt-8 pb-4 px-2 sm:px-6 bg-gradient-to-b from-gray-50/80 to-white rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden">
        {/* Subtle decorative background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 bg-amber-400/10 blur-3xl pointer-events-none rounded-full" />

        {/* Dynamic Podium Layout: 1, 2, or 3+ participants */}
        {entries.length === 1 && first && (
          // Single participant layout
          <div className="max-w-xs mx-auto flex flex-col items-center">
            <PodiumPedestal
              entry={first}
              place="GOLD"
              heightClass="h-64 sm:h-72"
              delayClass="animate-podium-first"
              isTied={false}
            />
          </div>
        )}

        {entries.length === 2 && first && second && (
          // Two participants layout
          <div className="max-w-md mx-auto grid grid-cols-2 items-end gap-4 sm:gap-6">
            <PodiumPedestal
              entry={second}
              place="SILVER"
              heightClass="h-52 sm:h-60"
              delayClass="animate-podium-second"
              isTied={isTie1_2}
            />
            <PodiumPedestal
              entry={first}
              place="GOLD"
              heightClass="h-64 sm:h-72"
              delayClass="animate-podium-first"
              isTied={isTie1_2}
            />
          </div>
        )}

        {entries.length >= 3 && first && second && third && (
          // Full 3-podium Kahoot visual hierarchy: Silver (Left, 2nd), Gold (Center, 1st), Bronze (Right, 3rd)
          <div className="max-w-3xl mx-auto grid grid-cols-3 items-end gap-2.5 sm:gap-6 pt-4">
            {/* 2nd Place: Silver on the Left */}
            <div className="order-1">
              <PodiumPedestal
                entry={second}
                place="SILVER"
                heightClass="h-48 sm:h-56"
                delayClass="animate-podium-second"
                isTied={isTie1_2}
              />
            </div>

            {/* 1st Place: Gold in the Center */}
            <div className="order-2">
              <PodiumPedestal
                entry={first}
                place="GOLD"
                heightClass="h-64 sm:h-76"
                delayClass="animate-podium-first"
                isTied={isTie1_2}
              />
            </div>

            {/* 3rd Place: Bronze on the Right */}
            <div className="order-3">
              <PodiumPedestal
                entry={third}
                place="BRONZE"
                heightClass="h-36 sm:h-44"
                delayClass="animate-podium-third"
                isTied={isTie2_3}
              />
            </div>
          </div>
        )}

        {/* Podium Base Line */}
        <div className="w-full h-3 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded-full mt-1" />
      </div>

      {/* Ranks 4+ Leaderboard Table */}
      {runnersUp.length > 0 && (
        <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="p-4 sm:px-6 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-2">
              <Award className="w-4 h-4 text-gray-500" />
              <span>Remaining Leaderboard Standings</span>
            </h4>
            <span className="text-[11px] font-mono text-gray-500">
              Ranks 4 to {entries.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50/50 text-gray-500 uppercase text-[10px] tracking-wider border-b border-gray-100 font-bold">
                <tr>
                  <th className="py-3 px-4 w-16 text-center">Rank</th>
                  <th className="py-3 px-4">Candidate</th>
                  <th className="py-3 px-4 text-right">Question Pts</th>
                  <th className="py-3 px-4 text-right">EOS Speed Bonus</th>
                  <th className="py-3 px-4 text-right font-black">Total Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {runnersUp.map((entry) => {
                  const qPts = entry.question_score ?? entry.score;
                  const bonusPts = entry.eos_points ?? entry.speed_bonus_score ?? 0;
                  return (
                    <tr key={entry.rank} className="hover:bg-gray-50/80 transition">
                      <td className="py-3 px-4 text-center">
                        <span className="w-6 h-6 rounded-lg bg-gray-100 text-gray-700 font-bold font-mono text-xs inline-flex items-center justify-center">
                          #{entry.rank}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-gray-900">
                        {entry.student_name}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-gray-600">
                        {qPts} pts
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        {bonusPts > 0 ? (
                          <span className="inline-flex items-center text-amber-600 font-bold">
                            <Zap className="w-3 h-3 mr-0.5 text-amber-500" />
                            +{bonusPts}
                          </span>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-gray-900 text-sm">
                        {entry.score} pts
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Single Pedestal Child Component
// ============================================================================

interface PodiumPedestalProps {
  entry: PodiumEntry;
  place: 'GOLD' | 'SILVER' | 'BRONZE';
  heightClass: string;
  delayClass: string;
  isTied?: boolean;
}

function PodiumPedestal({
  entry,
  place,
  heightClass,
  delayClass,
  isTied = false,
}: PodiumPedestalProps) {
  const isGold = place === 'GOLD';
  const isSilver = place === 'SILVER';

  const qScore = entry.question_score ?? entry.score;
  const speedBonus = entry.eos_points ?? entry.speed_bonus_score ?? 0;

  // Theming & Accents
  const theme = isGold
    ? {
        border: 'border-amber-400',
        gradient: 'from-amber-400 via-yellow-500 to-amber-600',
        textGradient: 'from-amber-600 to-yellow-700',
        bgPedestal: 'bg-gradient-to-b from-amber-400 via-amber-500 to-yellow-600',
        shadow: 'shadow-[0_12px_30px_rgba(245,158,11,0.3)]',
        badgeBg: 'bg-amber-100 text-amber-900 border-amber-300',
        avatarBg: 'bg-gradient-to-br from-amber-400 to-yellow-500 text-white ring-4 ring-amber-300/60 shadow-lg',
        icon: Crown,
        rankNumber: '1',
      }
    : isSilver
    ? {
        border: 'border-slate-300',
        gradient: 'from-slate-200 via-gray-300 to-slate-400',
        textGradient: 'from-slate-600 to-gray-700',
        bgPedestal: 'bg-gradient-to-b from-slate-200 via-gray-300 to-slate-400',
        shadow: 'shadow-[0_10px_25px_rgba(148,163,184,0.25)]',
        badgeBg: 'bg-slate-100 text-slate-800 border-slate-300',
        avatarBg: 'bg-gradient-to-br from-slate-300 to-gray-400 text-white ring-4 ring-slate-200/80 shadow-md',
        icon: Medal,
        rankNumber: '2',
      }
    : {
        border: 'border-amber-700/60',
        gradient: 'from-amber-700 via-amber-800 to-amber-900',
        textGradient: 'from-amber-800 to-amber-950',
        bgPedestal: 'bg-gradient-to-b from-amber-700 via-amber-800 to-amber-900',
        shadow: 'shadow-[0_8px_20px_rgba(180,83,9,0.2)]',
        badgeBg: 'bg-amber-50 text-amber-950 border-amber-600/40',
        avatarBg: 'bg-gradient-to-br from-amber-700 to-amber-900 text-white ring-4 ring-amber-600/50 shadow-md',
        icon: Medal,
        rankNumber: '3',
      };

  const IconComponent = theme.icon;

  return (
    <div className={`flex flex-col items-center w-full transition-all duration-700 ${delayClass}`}>
      {/* Participant Info Floating Above Pedestal */}
      <div className="flex flex-col items-center text-center mb-3 w-full px-1">
        {/* Avatar with Place Badge */}
        <div className="relative mb-2">
          <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center font-black text-lg ${theme.avatarBg}`}>
            {entry.student_name ? entry.student_name.charAt(0).toUpperCase() : '?'}
          </div>
          <div className="absolute -top-2.5 -right-2 p-1 bg-white rounded-full shadow border border-gray-200">
            <IconComponent className={`w-4 h-4 ${isGold ? 'text-amber-500 fill-amber-400' : isSilver ? 'text-slate-500 fill-slate-300' : 'text-amber-700 fill-amber-600'}`} />
          </div>
        </div>

        {/* Student Name */}
        <p className="font-bold text-gray-900 text-xs sm:text-sm line-clamp-1 max-w-[130px] sm:max-w-[180px]" title={entry.student_name}>
          {entry.student_name}
        </p>

        {/* Total Score */}
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-sm sm:text-base font-black text-gray-950 font-mono">
            {entry.score}
          </span>
          <span className="text-[10px] uppercase font-bold text-gray-500">pts</span>
        </div>

        {/* Breakdown Tag (Question Points + EOS Speed Bonus) */}
        <div className="flex flex-col items-center gap-0.5 mt-1">
          <div className="flex flex-wrap items-center justify-center gap-1 text-[9px] sm:text-[10px] font-mono">
            <span className="inline-flex items-center text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-md border border-gray-200" title="Question points">
              <Target className="w-2.5 h-2.5 mr-0.5 text-gray-500" />
              {qScore}
            </span>
            {speedBonus > 0 && (
              <span className="inline-flex items-center text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200 font-bold" title="EOS speed bonus">
                <Zap className="w-2.5 h-2.5 mr-0.5 text-amber-500" />
                +{speedBonus}
              </span>
            )}
          </div>
          {isTied && (
            <span className="text-[9px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-1.5 py-0.2 rounded-full uppercase tracking-wider">
              Tied
            </span>
          )}
        </div>
      </div>

      {/* The Stepped Podium Pedestal */}
      <div
        className={`w-full ${heightClass} ${theme.bgPedestal} ${theme.shadow} rounded-t-3xl border-t-2 border-x border-white/40 flex flex-col items-center justify-start pt-4 relative group`}
      >
        {/* Subtle sheen highlight across top */}
        <div className="absolute inset-x-0 top-0 h-1 bg-white/60 rounded-t-3xl" />

        {/* Giant Rank Number on Pedestal Face */}
        <span className="text-4xl sm:text-6xl font-black text-white/90 drop-shadow-sm font-mono tracking-tighter">
          {theme.rankNumber}
        </span>

        {/* Place Pill */}
        <span className="mt-1 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-white/80 bg-black/15 rounded-full backdrop-blur-xs">
          {place}
        </span>

        {/* Decorative subtle star sparkles for 1st place */}
        {isGold && (
          <div className="mt-auto mb-4 flex items-center justify-center text-white/70">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
        )}
      </div>
    </div>
  );
}

export default KahootPodium;
