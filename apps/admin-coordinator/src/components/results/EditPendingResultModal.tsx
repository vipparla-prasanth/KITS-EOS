import React, { useState, useEffect } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import type { 
  ResultSubmissionItem, 
  ResultEligibleCandidate 
} from '@kits-eos/shared/src/types/models';
import { 
  X, 
  AlertTriangle, 
  CheckCircle2, 
  Trophy, 
  Medal, 
  Award, 
  Edit3, 
  ShieldAlert, 
  ChevronRight,
} from 'lucide-react';

interface EditPendingResultModalProps {
  submission: ResultSubmissionItem;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const EditPendingResultModal: React.FC<EditPendingResultModalProps> = ({
  submission,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [candidates, setCandidates] = useState<ResultEligibleCandidate[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);

  const [selectedWinnerId, setSelectedWinnerId] = useState<string>(submission.winner.team_id);
  const [selectedRunnerId, setSelectedRunnerId] = useState<string>(submission.runner?.team_id || '');
  const [selectedThirdId, setSelectedThirdId] = useState<string>(submission.third?.team_id || '');
  const [editReason, setEditReason] = useState<string>('');

  const [isConfirmStage, setIsConfirmStage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch eligible candidates for this sub-event
  useEffect(() => {
    if (!isOpen) return;

    setIsConfirmStage(false);
    setSubmitError(null);
    setEditReason('');
    setSelectedWinnerId(submission.winner.team_id);
    setSelectedRunnerId(submission.runner?.team_id || '');
    setSelectedThirdId(submission.third?.team_id || '');

    async function loadCandidates() {
      try {
        setIsLoadingCandidates(true);
        setCandidateError(null);

        const { data, error } = await supabase.rpc('admin_get_sub_event_eligible_candidates', {
          p_sub_event_id: submission.sub_event_id,
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
  }, [isOpen, submission]);

  if (!isOpen) return null;

  const eligibleCount = candidates.length;
  const isSingleCompetitor = eligibleCount === 1;

  // Validation
  const isReasonValid = editReason.trim().length >= 10;
  const isWinnerSelected = Boolean(selectedWinnerId);
  const isRunnerSelected = isSingleCompetitor ? true : Boolean(selectedRunnerId);
  const isUniqWinnerRunner = isSingleCompetitor ? true : selectedWinnerId !== selectedRunnerId;
  const isUniqThird = !selectedThirdId || (selectedThirdId !== selectedWinnerId && selectedThirdId !== selectedRunnerId);

  const canProceedToConfirm = 
    isReasonValid && 
    isWinnerSelected && 
    isRunnerSelected && 
    isUniqWinnerRunner && 
    isUniqThird;

  const currentWinnerName = submission.winner.team_name;
  const currentRunnerName = submission.runner?.team_name || 'None';
  const currentThirdName = submission.third?.team_name || 'None';

  const newWinnerCandidate = candidates.find(c => c.team_id === selectedWinnerId);
  const newRunnerCandidate = candidates.find(c => c.team_id === selectedRunnerId);
  const newThirdCandidate = candidates.find(c => c.team_id === selectedThirdId);

  const handleSubmitEdit = async () => {
    if (!canProceedToConfirm) return;

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      const { error } = await supabase.rpc('admin_edit_pending_result_submission', {
        p_submission_id: submission.submission_id,
        p_new_winner_team_id: selectedWinnerId,
        p_new_runner_team_id: selectedRunnerId || null,
        p_new_third_team_id: selectedThirdId || null,
        p_edit_reason: editReason.trim(),
        p_expected_updated_at: submission.updated_at || null,
      });

      if (error) throw error;

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to edit pending submission:', err);
      setSubmitError(err.message || 'Failed to update result submission.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-gray-200 w-full max-w-2xl overflow-hidden animate-scale-in my-8"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="px-6 py-4.5 bg-gradient-to-r from-gray-900 to-slate-800 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <Edit3 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider">
                Edit Pending Result Submission
              </h3>
              <p className="text-[11px] text-gray-300">
                {submission.sub_event_name} • {submission.category_name}
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
        <div className="p-6 space-y-5 max-h-[calc(85vh-120px)] overflow-y-auto">
          {submitError && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {candidateError && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
              <span>{candidateError}</span>
            </div>
          )}

          {!isConfirmStage ? (
            /* STAGE 1: Edit Form */
            <div className="space-y-5 text-xs">
              {/* Context Summary */}
              <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">Submitted By</span>
                  <span className="font-bold text-gray-800">{submission.coordinator_name} (@{submission.coordinator_username})</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">Status</span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-800">
                    Pending Approval
                  </span>
                </div>
              </div>

              {/* Current vs Replacement Selection */}
              <div className="space-y-4">
                {/* 1. Winner Selection */}
                <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-black uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                      <Trophy className="h-4 w-4 text-amber-600" />
                      1st Place — Winner
                    </label>
                    <span className="text-[10px] text-gray-500">
                      Current: <strong className="text-gray-800">{currentWinnerName}</strong>
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
                <div className="p-4 rounded-2xl border border-blue-200 bg-blue-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-black uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                      <Medal className="h-4 w-4 text-kits-blue" />
                      2nd Place — Runner-Up
                    </label>
                    <span className="text-[10px] text-gray-500">
                      Current: <strong className="text-gray-800">{currentRunnerName}</strong>
                    </span>
                  </div>

                  {isSingleCompetitor ? (
                    <div className="p-2.5 bg-blue-100/50 rounded-xl text-[11px] text-blue-800">
                      Only 1 eligible candidate attended. Runner-up is not applicable.
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
                <div className="p-4 rounded-2xl border border-purple-200 bg-purple-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-black uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
                      <Award className="h-4 w-4 text-purple-600" />
                      3rd Place (Optional)
                    </label>
                    <span className="text-[10px] text-gray-500">
                      Current: <strong className="text-gray-800">{currentThirdName}</strong>
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

              {/* Edit Reason (Mandatory, >= 10 chars) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-black uppercase tracking-wider text-gray-700">
                    Result Correction Reason <span className="text-red-500">*</span>
                  </label>
                  <span className={`text-[10px] font-mono ${editReason.trim().length >= 10 ? 'text-emerald-600 font-bold' : 'text-gray-400'}`}>
                    {editReason.trim().length}/10 chars min
                  </span>
                </div>
                <textarea
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="e.g. Corrected runner candidate after cross-verifying official score sheet and participant identity."
                  rows={3}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-kits-red text-xs resize-none"
                />
              </div>
            </div>
          ) : (
            /* STAGE 2: Confirmation Screen */
            <div className="space-y-5 text-xs">
              <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 text-amber-900 font-black uppercase tracking-wider">
                  <ShieldAlert className="h-4 w-4 text-amber-600" />
                  <span>Review Proposed Changes</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Please review the modifications below. This action will update the pending result submission and be permanently logged in the audit trail. The result will remain in <strong>PENDING_ADMIN_APPROVAL</strong> status until you explicitly approve it.
                </p>
              </div>

              {/* Comparison Table */}
              <div className="border border-gray-200 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-100 text-gray-600 uppercase text-[10px] font-black tracking-wider">
                    <tr>
                      <th className="p-3">Podium Place</th>
                      <th className="p-3">Current Candidate</th>
                      <th className="p-3 text-kits-red">New Proposed Candidate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    <tr className="bg-white">
                      <td className="p-3 font-bold text-amber-700 flex items-center gap-1">
                        <Trophy className="h-3.5 w-3.5" /> 1st (Winner)
                      </td>
                      <td className="p-3 text-gray-600">{currentWinnerName}</td>
                      <td className="p-3 font-bold text-gray-900">
                        {newWinnerCandidate?.team_name || selectedWinnerId}
                      </td>
                    </tr>
                    <tr className="bg-gray-50/50">
                      <td className="p-3 font-bold text-kits-blue flex items-center gap-1">
                        <Medal className="h-3.5 w-3.5" /> 2nd (Runner)
                      </td>
                      <td className="p-3 text-gray-600">{currentRunnerName}</td>
                      <td className="p-3 font-bold text-gray-900">
                        {newRunnerCandidate?.team_name || (selectedRunnerId ? selectedRunnerId : 'None')}
                      </td>
                    </tr>
                    <tr className="bg-white">
                      <td className="p-3 font-bold text-purple-700 flex items-center gap-1">
                        <Award className="h-3.5 w-3.5" /> 3rd Place
                      </td>
                      <td className="p-3 text-gray-600">{currentThirdName}</td>
                      <td className="p-3 font-bold text-gray-900">
                        {newThirdCandidate?.team_name || 'None'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Reason Box */}
              <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-2xl space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 block">
                  Recorded Audit Reason
                </span>
                <p className="text-gray-800 italic font-mono text-[11px]">
                  "{editReason.trim()}"
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          {!isConfirmStage ? (
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
                disabled={!canProceedToConfirm || isLoadingCandidates}
                onClick={() => setIsConfirmStage(true)}
                className="px-5 py-2.5 bg-gray-900 hover:bg-black text-white text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer disabled:opacity-40 shadow-2xs flex items-center gap-1.5"
              >
                <span>Review & Confirm</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsConfirmStage(false)}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 transition cursor-pointer"
              >
                Back to Edit
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleSubmitEdit}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer disabled:opacity-50 shadow-md flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <span>Saving Edit...</span>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Confirm & Save Edit</span>
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
