import React, { useState, useEffect } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import type { 
  ResultEligibleCandidate, 
  PublishedResultCorrectionPreview 
} from '@kits-eos/shared/src/types/models';
import { 
  X, 
  AlertTriangle, 
  Trophy, 
  Medal, 
  Award, 
  ShieldAlert, 
  RefreshCw, 
  ChevronRight, 
  Lock,
  UserX,
  UserCheck,
  ShieldCheck
} from 'lucide-react';

interface CorrectPublishedResultModalProps {
  subEventId: string;
  subEventName: string;
  categoryName?: string;
  eventName?: string;
  currentWinnerTeamId: string | null;
  currentRunnerTeamId: string | null;
  currentThirdTeamId: string | null;
  subEventUpdatedAt?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const CorrectPublishedResultModal: React.FC<CorrectPublishedResultModalProps> = ({
  subEventId,
  subEventName,
  categoryName,
  eventName,
  currentWinnerTeamId,
  currentRunnerTeamId,
  currentThirdTeamId,
  subEventUpdatedAt,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [stage, setStage] = useState<'SELECTION' | 'CHALLENGE_CONFIRM'>('SELECTION');
  const [candidates, setCandidates] = useState<ResultEligibleCandidate[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);

  const [selectedWinnerId, setSelectedWinnerId] = useState<string>(currentWinnerTeamId || '');
  const [selectedRunnerId, setSelectedRunnerId] = useState<string>(currentRunnerTeamId || '');
  const [selectedThirdId, setSelectedThirdId] = useState<string>(currentThirdTeamId || '');
  const [correctionReason, setCorrectionReason] = useState<string>('');

  const [preview, setPreview] = useState<PublishedResultCorrectionPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const [confirmationInput, setConfirmationInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const REQUIRED_CONFIRMATION_PHRASE = 'CONFIRM RESULT EDIT';

  // Load eligible candidates
  useEffect(() => {
    if (!isOpen) return;

    setStage('SELECTION');
    setErrorMessage(null);
    setCorrectionReason('');
    setConfirmationInput('');
    setSelectedWinnerId(currentWinnerTeamId || '');
    setSelectedRunnerId(currentRunnerTeamId || '');
    setSelectedThirdId(currentThirdTeamId || '');
    setPreview(null);

    async function loadCandidates() {
      try {
        setIsLoadingCandidates(true);
        setCandidateError(null);

        const { data, error } = await supabase.rpc('admin_get_sub_event_eligible_candidates', {
          p_sub_event_id: subEventId,
        });

        if (error) throw error;
        setCandidates((data as ResultEligibleCandidate[]) || []);
      } catch (err: any) {
        console.error('Failed to load eligible candidates:', err);
        setCandidateError(err.message || 'Failed to load eligible candidates.');
      } finally {
        setIsLoadingCandidates(false);
      }
    }

    loadCandidates();
  }, [isOpen, subEventId, currentWinnerTeamId, currentRunnerTeamId, currentThirdTeamId]);

  // Load impact preview whenever candidate selections change
  useEffect(() => {
    if (!isOpen || !selectedWinnerId) {
      setPreview(null);
      return;
    }

    async function fetchPreview() {
      try {
        setIsLoadingPreview(true);
        const { data, error } = await supabase.rpc('admin_preview_published_result_correction', {
          p_sub_event_id: subEventId,
          p_new_winner_team_id: selectedWinnerId,
          p_new_runner_team_id: selectedRunnerId || null,
          p_new_third_team_id: selectedThirdId || null,
        });

        if (error) throw error;
        setPreview(data as PublishedResultCorrectionPreview);
      } catch (err: any) {
        console.warn('Could not generate preview:', err);
      } finally {
        setIsLoadingPreview(false);
      }
    }

    fetchPreview();
  }, [isOpen, subEventId, selectedWinnerId, selectedRunnerId, selectedThirdId]);

  if (!isOpen) return null;

  const eligibleCount = candidates.length;
  const isSingleCompetitor = eligibleCount === 1;

  // Validation rules
  const isReasonValid = correctionReason.trim().length >= 10;
  const isWinnerSelected = Boolean(selectedWinnerId);
  const isRunnerSelected = isSingleCompetitor ? true : Boolean(selectedRunnerId);
  const isUniqWinnerRunner = isSingleCompetitor ? true : selectedWinnerId !== selectedRunnerId;
  const isUniqThird = !selectedThirdId || (selectedThirdId !== selectedWinnerId && selectedThirdId !== selectedRunnerId);
  
  const isNotIdentical = 
    selectedWinnerId !== currentWinnerTeamId || 
    (selectedRunnerId || null) !== (currentRunnerTeamId || null) || 
    (selectedThirdId || null) !== (currentThirdTeamId || null);

  const canContinueToStage2 = 
    isReasonValid && 
    isWinnerSelected && 
    isRunnerSelected && 
    isUniqWinnerRunner && 
    isUniqThird && 
    isNotIdentical;

  const isChallengeMatched = confirmationInput.trim() === REQUIRED_CONFIRMATION_PHRASE;

  const handleExecuteCorrection = async () => {
    if (!canContinueToStage2 || !isChallengeMatched) return;

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const { error } = await supabase.rpc('admin_correct_published_sub_event_result', {
        p_sub_event_id: subEventId,
        p_new_winner_team_id: selectedWinnerId,
        p_new_runner_team_id: selectedRunnerId || null,
        p_new_third_team_id: selectedThirdId || null,
        p_correction_reason: correctionReason.trim(),
        p_confirmation_token: REQUIRED_CONFIRMATION_PHRASE,
        p_expected_updated_at: subEventUpdatedAt || null,
      });

      if (error) throw error;

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to correct published result:', err);
      setErrorMessage(err.message || 'Failed to apply result correction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-gray-200 w-full max-w-3xl overflow-hidden animate-scale-in my-8"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="px-6 py-4.5 bg-gradient-to-r from-red-950 via-slate-900 to-black text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30">
              <ShieldAlert className="h-5 w-5 text-kits-red" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black uppercase tracking-wider">
                  {stage === 'SELECTION' ? 'EDIT RESULT — STEP 1 OF 2' : 'FINAL CONFIRMATION — STEP 2 OF 2'}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-red-900/80 text-red-200 border border-red-700">
                  ONE-TIME CORRECTION
                </span>
              </div>
              <p className="text-[11px] text-gray-300">
                {subEventName} {categoryName ? `• ${categoryName}` : ''} {eventName ? `• ${eventName}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[calc(85vh-130px)] overflow-y-auto">
          {errorMessage && (
            <div className="p-4 bg-red-50 border border-red-300 rounded-2xl text-xs text-red-800 font-bold flex items-center gap-2.5 animate-shake">
              <AlertTriangle className="h-5 w-5 text-kits-red shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {candidateError && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
              <span>{candidateError}</span>
            </div>
          )}

          {stage === 'SELECTION' ? (
            /* =========================================================================
               STAGE 1: Candidate Selection & Impact Preview
               ========================================================================= */
            <div className="space-y-5 text-xs">
              <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl text-amber-950 text-xs leading-relaxed space-y-1.5">
                <div className="flex items-center gap-2 font-black uppercase text-amber-900 tracking-wider">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>One-Time Published Result Correction</span>
                </div>
                <p className="font-bold text-[11px] text-amber-900">
                  IMPORTANT: This result can only be edited ONCE. After this correction is saved, no further Admin edits will be permitted.
                </p>
                <p className="text-[10px] text-amber-800">
                  Certificates for removed candidates will be safely <strong>REVOKED</strong>, and newly designated podium candidates will receive their achievement credentials. Participation certificates are strictly firewalled and will NOT be touched.
                </p>
              </div>

              {/* Selection Grids */}
              <div className="space-y-4">
                {/* 1. Winner Selection */}
                <div className="p-4 rounded-2xl border border-amber-300 bg-amber-50/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-black uppercase tracking-wider text-amber-950 flex items-center gap-1.5 text-xs">
                      <Trophy className="h-4 w-4 text-amber-600" />
                      Proposed 1st Place (Winner) <span className="text-red-500">*</span>
                    </label>
                    <span className="text-[11px] text-gray-500">
                      Currently Published: <strong className="text-gray-800">{preview?.current_podium.winner_name || 'N/A'}</strong>
                    </span>
                  </div>

                  <select
                    value={selectedWinnerId}
                    onChange={(e) => setSelectedWinnerId(e.target.value)}
                    disabled={isLoadingCandidates}
                    className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer text-xs"
                  >
                    <option value="">Select Winner...</option>
                    {candidates.map((c) => (
                      <option key={c.team_id} value={c.team_id} disabled={c.team_id === selectedRunnerId || c.team_id === selectedThirdId}>
                        {c.team_name} {c.is_team ? `(Leader: ${c.leader_name} • ${c.leader_college})` : `(${c.leader_college})`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Runner-Up Selection */}
                <div className="p-4 rounded-2xl border border-blue-300 bg-blue-50/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-black uppercase tracking-wider text-blue-950 flex items-center gap-1.5 text-xs">
                      <Medal className="h-4 w-4 text-kits-blue" />
                      Proposed 2nd Place (Runner-Up) {!isSingleCompetitor && <span className="text-red-500">*</span>}
                    </label>
                    <span className="text-[11px] text-gray-500">
                      Currently Published: <strong className="text-gray-800">{preview?.current_podium.runner_name || 'None'}</strong>
                    </span>
                  </div>

                  {isSingleCompetitor ? (
                    <div className="p-2.5 bg-blue-100/50 rounded-xl text-[11px] text-blue-800 font-bold">
                      Only 1 competitor attended. Runner-Up is not applicable.
                    </div>
                  ) : (
                    <select
                      value={selectedRunnerId}
                      onChange={(e) => setSelectedRunnerId(e.target.value)}
                      disabled={isLoadingCandidates}
                      className="w-full px-3.5 py-2.5 bg-white border border-blue-300 rounded-xl font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer text-xs"
                    >
                      <option value="">Select Runner-Up...</option>
                      {candidates.map((c) => (
                        <option key={c.team_id} value={c.team_id} disabled={c.team_id === selectedWinnerId || c.team_id === selectedThirdId}>
                          {c.team_name} {c.is_team ? `(Leader: ${c.leader_name} • ${c.leader_college})` : `(${c.leader_college})`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 3. Third Place Selection (Optional) */}
                <div className="p-4 rounded-2xl border border-purple-300 bg-purple-50/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-black uppercase tracking-wider text-purple-950 flex items-center gap-1.5 text-xs">
                      <Award className="h-4 w-4 text-purple-600" />
                      Proposed 3rd Place (Optional)
                    </label>
                    <span className="text-[11px] text-gray-500">
                      Currently Published: <strong className="text-gray-800">{preview?.current_podium.third_name || 'None'}</strong>
                    </span>
                  </div>

                  <select
                    value={selectedThirdId}
                    onChange={(e) => setSelectedThirdId(e.target.value)}
                    disabled={isLoadingCandidates}
                    className="w-full px-3.5 py-2.5 bg-white border border-purple-300 rounded-xl font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer text-xs"
                  >
                    <option value="">None / Skipped</option>
                    {candidates.map((c) => (
                      <option key={c.team_id} value={c.team_id} disabled={c.team_id === selectedWinnerId || c.team_id === selectedRunnerId}>
                        {c.team_name} {c.is_team ? `(Leader: ${c.leader_name} • ${c.leader_college})` : `(${c.leader_college})`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Mandatory Reason */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-black uppercase tracking-wider text-gray-800">
                    Mandatory Correction Reason <span className="text-red-500">*</span>
                  </label>
                  <span className={`text-[10px] font-mono ${isReasonValid ? 'text-emerald-600 font-bold' : 'text-gray-400'}`}>
                    {correctionReason.trim().length}/10 chars min
                  </span>
                </div>
                <textarea
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="e.g. Corrected official runner-up team following academic council re-evaluation of event evaluation rubrics."
                  rows={2}
                  className="w-full px-3.5 py-2 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red text-xs resize-none"
                />
              </div>

              {/* Real-time Certificate Impact Preview */}
              {preview && (
                <div className="p-4 bg-slate-900 text-white rounded-2xl space-y-3">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="font-black uppercase tracking-wider text-[11px] text-amber-400 flex items-center gap-1.5">
                      <RefreshCw className={`h-3.5 w-3.5 ${isLoadingPreview ? 'animate-spin' : ''}`} />
                      Certificate Impact Analysis
                    </span>
                    <span className="text-[10px] text-gray-400">
                      Zero Participation Certs Affected
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                    {/* Certificates to Revoke */}
                    <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl space-y-1.5">
                      <span className="text-red-400 font-black uppercase text-[10px] flex items-center gap-1">
                        <UserX className="h-3.5 w-3.5" />
                        Certificates to Revoke ({preview.certificates_to_revoke.length})
                      </span>
                      {preview.certificates_to_revoke.length === 0 ? (
                        <p className="text-gray-400 italic text-[10px]">No certificates will be revoked.</p>
                      ) : (
                        <ul className="space-y-1 text-[10px] text-red-200">
                          {preview.certificates_to_revoke.map((c) => (
                            <li key={c.certificate_id} className="truncate">
                              • <strong>{c.member_name}</strong> ({c.type}): <span className="font-mono text-gray-400">{c.certificate_code}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Certificates to Issue */}
                    <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl space-y-1.5">
                      <span className="text-emerald-400 font-black uppercase text-[10px] flex items-center gap-1">
                        <UserCheck className="h-3.5 w-3.5" />
                        Certificates to Issue ({preview.certificates_to_issue.length})
                      </span>
                      {preview.certificates_to_issue.length === 0 ? (
                        <p className="text-gray-400 italic text-[10px]">No new certificates to generate.</p>
                      ) : (
                        <ul className="space-y-1 text-[10px] text-emerald-200">
                          {preview.certificates_to_issue.map((c, i) => (
                            <li key={i} className="truncate">
                              • <strong>{c.member_name}</strong> ({c.type}) — {c.college}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Participation Certificate Firewall Active: 100% attendance & feedback rules preserved.</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* =========================================================================
               STAGE 2: High Security Challenge Confirmation
               ========================================================================= */
            <div className="space-y-5 text-xs">
              <div className="p-4 bg-red-100 border-2 border-red-400 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 text-red-950 font-black uppercase tracking-wider text-xs">
                  <ShieldAlert className="h-4 w-4 text-kits-red" />
                  <span>You are about to permanently use the ONE available result correction.</span>
                </div>
                <div className="text-[11px] text-red-900 leading-relaxed font-bold space-y-1">
                  <p>After this operation:</p>
                  <ul className="list-disc pl-5 space-y-1 text-red-950">
                    <li>The result can NEVER be edited again.</li>
                    <li>The correction will be permanently audited.</li>
                    <li>Achievement certificates may be reconciled with the corrected result.</li>
                  </ul>
                </div>
              </div>

              {/* Podium Transition Summary */}
              <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-100 text-gray-600 uppercase text-[10px] font-black tracking-wider">
                    <tr>
                      <th className="p-3">Position</th>
                      <th className="p-3">Currently Published</th>
                      <th className="p-3 text-kits-red">New Corrected Assignment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    <tr className="bg-white">
                      <td className="p-3 font-bold text-amber-700 flex items-center gap-1">
                        <Trophy className="h-3.5 w-3.5" /> 1st (Winner)
                      </td>
                      <td className="p-3 text-gray-500 line-through">
                        {preview?.current_podium.winner_name || 'N/A'}
                      </td>
                      <td className="p-3 font-black text-gray-900">
                        {preview?.proposed_podium.winner_name}
                      </td>
                    </tr>
                    <tr className="bg-gray-50/50">
                      <td className="p-3 font-bold text-kits-blue flex items-center gap-1">
                        <Medal className="h-3.5 w-3.5" /> 2nd (Runner)
                      </td>
                      <td className="p-3 text-gray-500 line-through">
                        {preview?.current_podium.runner_name || 'None'}
                      </td>
                      <td className="p-3 font-black text-gray-900">
                        {preview?.proposed_podium.runner_name || 'None'}
                      </td>
                    </tr>
                    <tr className="bg-white">
                      <td className="p-3 font-bold text-purple-700 flex items-center gap-1">
                        <Award className="h-3.5 w-3.5" /> 3rd Place
                      </td>
                      <td className="p-3 text-gray-500 line-through">
                        {preview?.current_podium.third_name || 'None'}
                      </td>
                      <td className="p-3 font-black text-gray-900">
                        {preview?.proposed_podium.third_name || 'None'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Audit Reason Confirmation */}
              <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-2xl space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 block">
                  Recorded Audit Justification
                </span>
                <p className="text-gray-900 font-mono text-[11px] italic">
                  "{correctionReason.trim()}"
                </p>
              </div>

              {/* Challenge Input */}
              <div className="p-4 bg-gray-950 text-white rounded-2xl space-y-2">
                <label className="text-[11px] font-black uppercase tracking-wider text-amber-300 block">
                  Type exactly: <span className="text-white font-mono select-all bg-white/20 px-2 py-0.5 rounded font-black">{REQUIRED_CONFIRMATION_PHRASE}</span>
                </label>
                <input
                  type="text"
                  value={confirmationInput}
                  onChange={(e) => setConfirmationInput(e.target.value)}
                  placeholder={REQUIRED_CONFIRMATION_PHRASE}
                  className="w-full px-3.5 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white font-mono font-bold tracking-wider placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 text-xs uppercase"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          {stage === 'SELECTION' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canContinueToStage2 || isLoadingCandidates}
                onClick={() => setStage('CHALLENGE_CONFIRM')}
                className="px-6 py-2.5 bg-kits-red hover:bg-red-800 text-white text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer disabled:opacity-40 shadow-sm flex items-center gap-1.5"
              >
                <span>CONTINUE</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!isChallengeMatched || isSubmitting}
                onClick={handleExecuteCorrection}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer disabled:opacity-30 shadow-md flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <span>Applying Correction...</span>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    <span>CONFIRM &amp; SAVE EDIT</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
