import { useState, useEffect } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import type { ResultSubmissionItem, ResultSubmissionMemberInfo } from '@kits-eos/shared/src/types/models';
import {
  Trophy,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Eye,
  Check,
  X,
  RefreshCw,
  Search,
  Building2,
  AlertCircle,
  ShieldCheck,
  Edit3,
  Lock,
} from 'lucide-react';
import { EditPendingResultModal } from './EditPendingResultModal';
import { CorrectPublishedResultModal } from './CorrectPublishedResultModal';

interface PendingResultSubmissionsProps {
  onSubmissionsUpdated?: () => void;
  onSelectSubEvent?: (eventId: string, categoryId?: string, subEventId?: string) => void;
}

export function PendingResultSubmissions({
  onSubmissionsUpdated,
}: PendingResultSubmissionsProps) {
  const [submissions, setSubmissions] = useState<ResultSubmissionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING_ADMIN_APPROVAL' | 'APPROVED' | 'REJECTED'>(
    'PENDING_ADMIN_APPROVAL'
  );
  const [searchTerm, setSearchTerm] = useState('');

  // Modals State
  const [selectedSubmission, setSelectedSubmission] = useState<ResultSubmissionItem | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);

  const [editPendingSubmissionTarget, setEditPendingSubmissionTarget] = useState<ResultSubmissionItem | null>(null);
  const [correctPublishedSubmissionTarget, setCorrectPublishedSubmissionTarget] = useState<ResultSubmissionItem | null>(null);

  const [approveSubmissionTarget, setApproveSubmissionTarget] = useState<ResultSubmissionItem | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const [rejectSubmissionTarget, setRejectSubmissionTarget] = useState<ResultSubmissionItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const fetchSubmissions = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: err } = await supabase.rpc('admin_get_result_submissions', {
        p_status: statusFilter === 'ALL' ? null : statusFilter,
      });

      if (err) throw err;

      setSubmissions((data as ResultSubmissionItem[]) || []);
    } catch (err: any) {
      console.error('Fetch result submissions error:', err);
      setError(err.message || 'Failed to load result submissions.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmissions();
  }, [statusFilter]);

  const filteredSubmissions = submissions.filter((sub) => {
    const q = searchTerm.toLowerCase();
    if (!q) return true;
    return (
      sub.sub_event_name.toLowerCase().includes(q) ||
      sub.event_name.toLowerCase().includes(q) ||
      sub.coordinator_name.toLowerCase().includes(q) ||
      sub.winner.team_name.toLowerCase().includes(q) ||
      (sub.runner && sub.runner.team_name.toLowerCase().includes(q))
    );
  });

  const pendingCount = submissions.filter((s) => s.status === 'PENDING_ADMIN_APPROVAL').length;

  const handleOpenApproveModal = (sub: ResultSubmissionItem) => {
    setApproveSubmissionTarget(sub);
    setApproveError(null);
  };

  const handleExecuteApprove = async () => {
    if (!approveSubmissionTarget) return;

    try {
      setIsApproving(true);
      setApproveError(null);

      const { data, error: rpcErr } = await supabase.rpc('admin_approve_result_submission', {
        p_submission_id: approveSubmissionTarget.submission_id,
      });

      if (rpcErr) throw rpcErr;

      if (!data?.success) {
        throw new Error(data?.error || data?.message || 'Failed to approve result submission.');
      }

      setSuccessMessage(
        `Results approved for ${approveSubmissionTarget.sub_event_name}! Generated ${data.total_certificates || 'all'} achievement certificates.`
      );
      setApproveSubmissionTarget(null);
      if (isViewModalOpen) setIsViewModalOpen(false);

      await fetchSubmissions();
      if (onSubmissionsUpdated) onSubmissionsUpdated();
    } catch (err: any) {
      console.error('Approve result submission error:', err);
      setApproveError(err.message || 'Failed to approve result submission.');
    } finally {
      setIsApproving(false);
    }
  };

  const handleOpenRejectModal = (sub: ResultSubmissionItem) => {
    setRejectSubmissionTarget(sub);
    setRejectionReason('');
    setRejectError(null);
  };

  const handleExecuteReject = async () => {
    if (!rejectSubmissionTarget) return;

    if (!rejectionReason.trim()) {
      setRejectError('Please provide a reason for rejection.');
      return;
    }

    try {
      setIsRejecting(true);
      setRejectError(null);

      const { data, error: rpcErr } = await supabase.rpc('admin_reject_result_submission', {
        p_submission_id: rejectSubmissionTarget.submission_id,
        p_rejection_reason: rejectionReason.trim(),
      });

      if (rpcErr) throw rpcErr;

      if (!data?.success) {
        throw new Error(data?.error || data?.message || 'Failed to reject result submission.');
      }

      setSuccessMessage(
        `Result submission for ${rejectSubmissionTarget.sub_event_name} rejected. The coordinator has been notified.`
      );
      setRejectSubmissionTarget(null);
      setRejectionReason('');
      if (isViewModalOpen) setIsViewModalOpen(false);

      await fetchSubmissions();
      if (onSubmissionsUpdated) onSubmissionsUpdated();
    } catch (err: any) {
      console.error('Reject result submission error:', err);
      setRejectError(err.message || 'Failed to reject result submission.');
    } finally {
      setIsRejecting(false);
    }
  };

  const renderMemberRoster = (members: ResultSubmissionMemberInfo[]) => {
    return (
      <div className="overflow-x-auto rounded-xl border border-gray-200 mt-2">
        <table className="w-full text-[11px] text-left">
          <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-black uppercase text-gray-500 tracking-wider">
            <tr>
              <th className="py-2 px-3">Participant</th>
              <th className="py-2 px-3">Roll Number</th>
              <th className="py-2 px-3">College</th>
              <th className="py-2 px-3">Dept & Year</th>
              <th className="py-2 px-3 text-center">Attendance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {members.map((m) => (
              <tr key={m.member_id} className="hover:bg-gray-50">
                <td className="py-2 px-3 font-bold text-gray-900">
                  <div className="flex items-center gap-1.5">
                    <span>{m.name}</span>
                    {m.is_leader && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-red-100 text-kits-red border border-red-200">
                        Leader
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 px-3 font-mono text-gray-600">{m.roll_number || 'N/A'}</td>
                <td className="py-2 px-3 text-gray-700">{m.college || 'KITS'}</td>
                <td className="py-2 px-3 text-gray-600">
                  {m.department} • Year {m.year}
                </td>
                <td className="py-2 px-3 text-center">
                  {m.is_attended ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                      <Check className="h-3 w-3" />
                      Attended
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-gray-100 text-gray-500 border border-gray-200">
                      Absent
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-200 shadow-2xs space-y-4">
      {/* Header & Controls */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-red-50 text-kits-red rounded-xl">
            <Trophy className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black tracking-tight text-gray-900 uppercase">
                Coordinator Result Submissions Review
              </h2>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                  {pendingCount} PENDING
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 font-medium">
              Review and approve or reject proposed podium results submitted by assigned coordinators.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Refresh Button */}
          <button
            type="button"
            onClick={fetchSubmissions}
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 hover:text-gray-900 transition shadow-2xs cursor-pointer"
            title="Refresh Submissions"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {/* Status Tabs */}
          <div className="flex items-center bg-gray-100 p-1 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setStatusFilter('PENDING_ADMIN_APPROVAL')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                statusFilter === 'PENDING_ADMIN_APPROVAL'
                  ? 'bg-white text-gray-900 shadow-2xs font-black'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Pending Approval
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('APPROVED')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                statusFilter === 'APPROVED'
                  ? 'bg-white text-gray-900 shadow-2xs font-black'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Approved
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('REJECTED')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                statusFilter === 'REJECTED'
                  ? 'bg-white text-gray-900 shadow-2xs font-black'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Rejected
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                statusFilter === 'ALL'
                  ? 'bg-white text-gray-900 shadow-2xs font-black'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              All History
            </button>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-bold flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter by sub-event, event, coordinator, or winning team name..."
          className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
        />
      </div>

      {/* Submissions Table / Cards */}
      {isLoading ? (
        <div className="p-12 text-center space-y-2">
          <RefreshCw className="h-6 w-6 animate-spin text-kits-red mx-auto" />
          <p className="text-xs text-gray-500 font-bold">Loading Result Submissions...</p>
        </div>
      ) : filteredSubmissions.length === 0 ? (
        <div className="p-10 text-center space-y-2 border border-dashed border-gray-200 rounded-2xl">
          <Trophy className="h-8 w-8 text-gray-300 mx-auto" />
          <h4 className="text-xs font-black text-gray-700 uppercase tracking-wider">
            No Submissions Found
          </h4>
          <p className="text-[11px] text-gray-400">
            {statusFilter === 'PENDING_ADMIN_APPROVAL'
              ? 'There are currently no pending result submissions awaiting administrator review.'
              : 'No result submissions match the selected status filter.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-50/80 border-b border-gray-200 text-[10px] font-black uppercase text-gray-500 tracking-wider">
              <tr>
                <th className="py-3 px-4">Event & Sub-Event</th>
                <th className="py-3 px-4">Coordinator</th>
                <th className="py-3 px-4">Proposed Winner</th>
                <th className="py-3 px-4">Proposed Runner</th>
                <th className="py-3 px-4">Submitted At</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredSubmissions.map((sub) => (
                <tr key={sub.submission_id} className="hover:bg-gray-50/70 transition">
                  {/* Event & Sub-Event */}
                  <td className="py-3.5 px-4 font-bold text-gray-900">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-kits-red">{sub.sub_event_name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-gray-100 text-gray-600 border border-gray-200 uppercase">
                        {sub.participation_type}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 font-medium">
                      {sub.event_name} • {sub.category_name}
                    </div>
                  </td>

                  {/* Coordinator */}
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-gray-900">{sub.coordinator_name}</div>
                    <div className="text-[10px] text-gray-400 font-mono">@{sub.coordinator_username}</div>
                  </td>

                  {/* Winner */}
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-gray-900 flex items-center gap-1.5">
                      <span className="text-emerald-600 font-black">🏆</span>
                      <span className="truncate max-w-[150px]">{sub.winner.team_name}</span>
                    </div>
                    <div className="text-[10px] text-gray-500 truncate max-w-[150px]">
                      {sub.winner.leader_college}
                    </div>
                  </td>

                  {/* Runner */}
                  <td className="py-3.5 px-4">
                    {sub.runner ? (
                      <div>
                        <div className="font-bold text-gray-900 flex items-center gap-1.5">
                          <span className="text-slate-500 font-black">🥈</span>
                          <span className="truncate max-w-[150px]">{sub.runner.team_name}</span>
                        </div>
                        <div className="text-[10px] text-gray-500 truncate max-w-[150px]">
                          {sub.runner.leader_college}
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-400 font-medium text-[11px]">—</span>
                    )}
                  </td>

                  {/* Submitted Date */}
                  <td className="py-3.5 px-4 text-gray-600 font-mono text-[11px]">
                    {formatDateTime12h(sub.submitted_at)}
                  </td>

                  {/* Status Badge */}
                  <td className="py-3.5 px-4 text-center">
                    {sub.status === 'APPROVED' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        APPROVED
                      </span>
                    )}
                    {sub.status === 'PENDING_ADMIN_APPROVAL' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                        <Clock className="h-3 w-3 text-amber-600" />
                        PENDING
                      </span>
                    )}
                    {sub.status === 'REJECTED' && (
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-900 border border-red-300"
                        title={sub.rejection_reason || 'Rejected'}
                      >
                        <AlertTriangle className="h-3 w-3 text-kits-red" />
                        REJECTED
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* View Details */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSubmission(sub);
                          setIsViewModalOpen(true);
                        }}
                        className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 transition cursor-pointer"
                        title="View Full Details"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>

                      {/* If Pending: Edit, Approve & Reject Buttons */}
                      {sub.status === 'PENDING_ADMIN_APPROVAL' && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditPendingSubmissionTarget(sub)}
                            className="p-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 transition cursor-pointer"
                            title="Edit Pending Result (Select different candidates)"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenApproveModal(sub)}
                            className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition cursor-pointer"
                            title="Approve Result & Issue Certificates"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenRejectModal(sub)}
                            className="p-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-kits-red transition cursor-pointer"
                            title="Reject Result Declaration"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}

                      {/* If Approved: Correct Published Result Button or Locked Badge */}
                      {sub.status === 'APPROVED' && (
                        (sub.result_edit_count ?? 0) >= 1 ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider bg-gray-100 text-gray-500 border border-gray-200 cursor-not-allowed"
                            title="Result correction has already been used. Result is permanently locked."
                          >
                            <Lock className="h-3 w-3 text-gray-400" />
                            <span>Locked</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setCorrectPublishedSubmissionTarget(sub)}
                            className="p-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-kits-red transition cursor-pointer"
                            title="Correct Published Result (1 Edit Available)"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* =========================================================================
          VIEW DETAILS MODAL (SECTION 12)
          ========================================================================= */}
      {isViewModalOpen && selectedSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl border border-gray-200 shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-200 flex items-center justify-between gap-3 bg-gray-50/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-red-50 text-kits-red rounded-xl">
                  <Trophy className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900 tracking-tight">
                    Submission Details: {selectedSubmission.sub_event_name}
                  </h3>
                  <p className="text-xs text-gray-500 font-medium">
                    Coordinator: {selectedSubmission.coordinator_name} • Submitted:{' '}
                    {formatDateTime12h(selectedSubmission.submitted_at)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsViewModalOpen(false)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Event Context Header */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-200 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase text-gray-400 block">Event</span>
                  <span className="font-bold text-gray-900">{selectedSubmission.event_name}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-gray-400 block">Category</span>
                  <span className="font-bold text-gray-900">{selectedSubmission.category_name}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-gray-400 block">Track Type</span>
                  <span className="font-bold text-kits-red uppercase">{selectedSubmission.participation_type}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-gray-400 block">Current Status</span>
                  <span className="font-black text-gray-900">{selectedSubmission.status}</span>
                </div>
                {selectedSubmission.status === 'APPROVED' && (
                  <div className="sm:col-span-2 md:col-span-4 pt-1">
                    <span className="text-[10px] font-bold uppercase text-gray-400 block">Edit Status</span>
                    {(selectedSubmission.result_edit_count ?? 0) >= 1 ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-black bg-amber-50 text-amber-800 border border-amber-200">
                        <Lock className="h-3.5 w-3.5 text-amber-600" />
                        Result correction used: YES (Locked)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                        1 Edit Available
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Published Edit Audit Note if already edited */}
              {selectedSubmission.status === 'APPROVED' && (selectedSubmission.result_edit_count ?? 0) >= 1 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-amber-900">
                    <Lock className="h-3.5 w-3.5 text-amber-700" />
                    <span>Correction History (Result Permanently Locked)</span>
                  </div>
                  {selectedSubmission.result_edited_at && (
                    <p className="text-[11px] text-amber-800 font-medium">
                      Edited on: {formatDateTime12h(selectedSubmission.result_edited_at)}
                    </p>
                  )}
                  {selectedSubmission.result_edit_reason && (
                    <p className="text-amber-950 font-medium italic mt-1">
                      Reason: "{selectedSubmission.result_edit_reason}"
                    </p>
                  )}
                </div>
              )}

              {/* Rejection Reason (if rejected) */}
              {selectedSubmission.status === 'REJECTED' && selectedSubmission.rejection_reason && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs space-y-1">
                  <span className="text-[10px] font-black uppercase text-kits-red block">
                    Rejection Reason
                  </span>
                  <p className="text-red-950 font-bold italic">
                    "{selectedSubmission.rejection_reason}"
                  </p>
                </div>
              )}

              {/* 1. Winner Team / Participant Card */}
              <div className="p-5 bg-emerald-50/50 border border-emerald-200 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-600 text-white">
                    🏆 Proposed Winner (1st Place)
                  </span>
                  <span className="text-xs font-bold text-emerald-900">
                    Leader: {selectedSubmission.winner.leader_name}
                  </span>
                </div>

                <div className="text-base font-black text-gray-900">
                  {selectedSubmission.winner.team_name}
                </div>

                <div className="text-xs text-gray-600 flex items-center gap-1.5 font-medium">
                  <Building2 className="h-3.5 w-3.5 text-gray-400" />
                  <span>{selectedSubmission.winner.leader_college}</span>
                </div>

                {/* Member Roster with Individual Colleges */}
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
                    Team Members & Attendance Verification:
                  </span>
                  {renderMemberRoster(selectedSubmission.winner.members)}
                </div>
              </div>

              {/* 2. Runner Team / Participant Card */}
              {selectedSubmission.runner && (
                <div className="p-5 bg-blue-50/50 border border-blue-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-700 text-white">
                      🥈 Proposed Runner-Up (2nd Place)
                    </span>
                    <span className="text-xs font-bold text-blue-900">
                      Leader: {selectedSubmission.runner.leader_name}
                    </span>
                  </div>

                  <div className="text-base font-black text-gray-900">
                    {selectedSubmission.runner.team_name}
                  </div>

                  <div className="text-xs text-gray-600 flex items-center gap-1.5 font-medium">
                    <Building2 className="h-3.5 w-3.5 text-gray-400" />
                    <span>{selectedSubmission.runner.leader_college}</span>
                  </div>

                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
                      Team Members & Attendance Verification:
                    </span>
                    {renderMemberRoster(selectedSubmission.runner.members)}
                  </div>
                </div>
              )}

              {/* 3. Third Place Team Card (if present) */}
              {selectedSubmission.third && (
                <div className="p-5 bg-amber-50/50 border border-amber-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-600 text-white">
                      🥉 Proposed 3rd Place
                    </span>
                    <span className="text-xs font-bold text-amber-900">
                      Leader: {selectedSubmission.third.leader_name}
                    </span>
                  </div>

                  <div className="text-base font-black text-gray-900">
                    {selectedSubmission.third.team_name}
                  </div>

                  <div className="text-xs text-gray-600 flex items-center gap-1.5 font-medium">
                    <Building2 className="h-3.5 w-3.5 text-gray-400" />
                    <span>{selectedSubmission.third.leader_college}</span>
                  </div>

                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">
                      Team Members & Attendance Verification:
                    </span>
                    {renderMemberRoster(selectedSubmission.third.members)}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsViewModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold transition cursor-pointer"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                {selectedSubmission.status === 'PENDING_ADMIN_APPROVAL' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const target = selectedSubmission;
                        setIsViewModalOpen(false);
                        setEditPendingSubmissionTarget(target);
                      }}
                      className="px-4 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                    >
                      <Edit3 className="h-4 w-4 text-amber-700" />
                      <span>Edit Candidates</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenRejectModal(selectedSubmission)}
                      className="px-4 py-2 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-kits-red text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                    >
                      <X className="h-4 w-4" />
                      <span>Reject Submission</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenApproveModal(selectedSubmission)}
                      className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition shadow-sm cursor-pointer flex items-center gap-1.5"
                    >
                      <Check className="h-4 w-4" />
                      <span>Approve & Issue Certificates</span>
                    </button>
                  </>
                )}

                {selectedSubmission.status === 'APPROVED' && (
                  (selectedSubmission.result_edit_count ?? 0) >= 1 ? (
                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 border border-gray-200 text-gray-500 text-xs font-black cursor-not-allowed">
                      <Lock className="h-4 w-4 text-gray-400" />
                      <span>EDIT USED — RESULT LOCKED</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const target = selectedSubmission;
                        setIsViewModalOpen(false);
                        setCorrectPublishedSubmissionTarget(target);
                      }}
                      className="px-4 py-2 rounded-xl border border-red-300 bg-red-50 hover:bg-red-100 text-kits-red text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                    >
                      <Edit3 className="h-4 w-4 text-kits-red" />
                      <span>Correct Published Result</span>
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          APPROVE CONFIRMATION MODAL (SECTION 13)
          ========================================================================= */}
      {approveSubmissionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl border border-gray-200 shadow-2xl w-full max-w-lg overflow-hidden space-y-6 p-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900 tracking-tight">
                    Approve Result Declaration?
                  </h3>
                  <p className="text-[11px] text-gray-500 font-medium">
                    Sub-Event: {approveSubmissionTarget.sub_event_name}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setApproveSubmissionTarget(null)}
                disabled={isApproving}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {approveError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold">
                {approveError}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-1">
                <span className="text-[10px] font-black uppercase text-emerald-800 block">
                  Winner (1st Place)
                </span>
                <div className="text-sm font-black text-emerald-950">
                  {approveSubmissionTarget.winner.team_name}
                </div>
                <div className="text-[11px] text-emerald-800">
                  {approveSubmissionTarget.winner.leader_college}
                </div>
              </div>

              {approveSubmissionTarget.runner && (
                <div className="p-3.5 bg-blue-50 rounded-2xl border border-blue-200 space-y-1">
                  <span className="text-[10px] font-black uppercase text-blue-800 block">
                    Runner-Up (2nd Place)
                  </span>
                  <div className="text-sm font-black text-blue-950">
                    {approveSubmissionTarget.runner.team_name}
                  </div>
                  <div className="text-[11px] text-blue-800">
                    {approveSubmissionTarget.runner.leader_college}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-[11px] text-gray-600 font-medium leading-relaxed">
              <span className="font-bold text-gray-900 block mb-0.5">Approval Action:</span>
              Approving this result will officially publish results and automatically generate eligible achievement certificates for attended participants.
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setApproveSubmissionTarget(null)}
                disabled={isApproving}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecuteApprove}
                disabled={isApproving}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isApproving ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Approving...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    <span>Approve & Issue Certificates</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          REJECT REASON MODAL (SECTION 20)
          ========================================================================= */}
      {rejectSubmissionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl border border-gray-200 shadow-2xl w-full max-w-lg overflow-hidden space-y-6 p-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-red-50 text-kits-red rounded-xl">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900 tracking-tight">
                    Reject Result Submission
                  </h3>
                  <p className="text-[11px] text-gray-500 font-medium">
                    Sub-Event: {rejectSubmissionTarget.sub_event_name}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setRejectSubmissionTarget(null)}
                disabled={isRejecting}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {rejectError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold">
                {rejectError}
              </div>
            )}

            <div className="space-y-2 text-xs">
              <label className="text-[10px] font-black uppercase tracking-wider text-gray-700 block">
                Rejection Reason <span className="text-kits-red">*</span>
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why this result submission is rejected (e.g. Winner/Runner selection correction needed, candidate disputed, etc.)..."
                rows={4}
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:bg-white focus:border-kits-red focus:ring-1 focus:ring-kits-red resize-none"
                required
              />
              <p className="text-[11px] text-gray-500">
                The assigned coordinator ({rejectSubmissionTarget.coordinator_name}) will see this reason in their portal and can submit a corrected result.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRejectSubmissionTarget(null)}
                disabled={isRejecting}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecuteReject}
                disabled={isRejecting || !rejectionReason.trim()}
                className="px-5 py-2 rounded-xl bg-kits-red hover:bg-red-700 text-white text-xs font-black transition shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isRejecting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Rejecting...</span>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4" />
                    <span>Reject Result</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          OPERATION A: EDIT PENDING RESULT SUBMISSION MODAL
          ========================================================================= */}
      {editPendingSubmissionTarget && (
        <EditPendingResultModal
          submission={editPendingSubmissionTarget}
          isOpen={Boolean(editPendingSubmissionTarget)}
          onClose={() => setEditPendingSubmissionTarget(null)}
          onSuccess={() => {
            setSuccessMessage(`Result candidates for "${editPendingSubmissionTarget.sub_event_name}" updated successfully.`);
            fetchSubmissions();
            if (onSubmissionsUpdated) onSubmissionsUpdated();
          }}
        />
      )}

      {/* =========================================================================
          OPERATION B: CORRECT PUBLISHED RESULT MODAL (TWO-STEP SECURITY CONFIRMATION)
          ========================================================================= */}
      {correctPublishedSubmissionTarget && (
        <CorrectPublishedResultModal
          subEventId={correctPublishedSubmissionTarget.sub_event_id}
          subEventName={correctPublishedSubmissionTarget.sub_event_name}
          categoryName={correctPublishedSubmissionTarget.category_name}
          eventName={correctPublishedSubmissionTarget.event_name}
          currentWinnerTeamId={correctPublishedSubmissionTarget.winner.team_id}
          currentRunnerTeamId={correctPublishedSubmissionTarget.runner?.team_id || null}
          currentThirdTeamId={correctPublishedSubmissionTarget.third?.team_id || null}
          subEventUpdatedAt={correctPublishedSubmissionTarget.updated_at || null}
          isOpen={Boolean(correctPublishedSubmissionTarget)}
          onClose={() => setCorrectPublishedSubmissionTarget(null)}
          onSuccess={() => {
            setSuccessMessage(`Published results for "${correctPublishedSubmissionTarget.sub_event_name}" corrected successfully.`);
            fetchSubmissions();
            if (onSubmissionsUpdated) onSubmissionsUpdated();
          }}
        />
      )}
    </div>
  );
}
