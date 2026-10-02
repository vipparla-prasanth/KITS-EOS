import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  UserX,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Eye,
  Check,
  X,
  RefreshCw,
  MessageSquare
} from 'lucide-react';

interface SuspensionRequestItem {
  id: string;
  student_id: string;
  request_message: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  admin_response: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  student_profiles?: {
    user_id: string;
    full_name: string;
    roll_number: string;
    department: string;
    year_of_study: number;
    college: string;
    account_status: string;
    suspension_reason: string | null;
  } | null;
}

export function SuspensionRequestsList() {
  const [requests, setRequests] = useState<SuspensionRequestItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusTab, setStatusTab] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');

  // Review Modal State
  const [reviewModal, setReviewModal] = useState<{
    open: boolean;
    request: SuspensionRequestItem | null;
    action: 'APPROVE' | 'REJECT' | 'VIEW' | null;
    adminNote: string;
    loading: boolean;
    error: string | null;
  }>({
    open: false,
    request: null,
    action: null,
    adminNote: '',
    loading: false,
    error: null,
  });

  async function fetchRequests() {
    try {
      setIsLoading(true);
      setError(null);

      // Authoritative Admin RPC: Single secure read boundary
      const { data, error: rpcErr } = await supabase.rpc('admin_get_suspension_requests');

      if (rpcErr) throw rpcErr;

      setRequests((data as unknown as SuspensionRequestItem[]) || []);
    } catch (err: any) {
      console.error('Failed to load suspension requests:', err);
      setError(err.message || 'Failed to load suspension requests.');
      setRequests([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchRequests();
  }, []);

  // Counts for tabs
  const counts = useMemo(() => {
    return {
      PENDING: requests.filter((r) => r.status === 'PENDING').length,
      APPROVED: requests.filter((r) => r.status === 'APPROVED').length,
      REJECTED: requests.filter((r) => r.status === 'REJECTED').length,
      ALL: requests.length,
    };
  }, [requests]);

  // Filtered requests based on active tab and search query
  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (statusTab !== 'ALL' && r.status !== statusTab) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const profile = r.student_profiles;
        const nameMatch = profile?.full_name?.toLowerCase().includes(q);
        const rollMatch = profile?.roll_number?.toLowerCase().includes(q);
        const messageMatch = r.request_message?.toLowerCase().includes(q);
        return nameMatch || rollMatch || messageMatch;
      }

      return true;
    });
  }, [requests, statusTab, searchQuery]);

  // Handlers for modal
  const handleOpenReview = (request: SuspensionRequestItem) => {
    setReviewModal({
      open: true,
      request,
      action: request.status === 'PENDING' ? null : 'VIEW',
      adminNote: '',
      loading: false,
      error: null,
    });
  };

  const handleCloseReview = () => {
    if (!reviewModal.loading) {
      setReviewModal({
        open: false,
        request: null,
        action: null,
        adminNote: '',
        loading: false,
        error: null,
      });
    }
  };

  const handleConfirmDecision = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!reviewModal.request) return;

    setReviewModal((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_review_unsuspension_request', {
        p_request_id: reviewModal.request.id,
        p_decision: decision,
        p_admin_note: reviewModal.adminNote.trim() || null,
      });

      if (rpcErr) throw rpcErr;
      if (data && !data.success) {
        throw new Error(data.message || `Failed to ${decision.toLowerCase()} request.`);
      }

      handleCloseReview();
      await fetchRequests();
    } catch (err: any) {
      console.error(`Failed to process unsuspension request (${decision}):`, err);
      setReviewModal((prev) => ({
        ...prev,
        loading: false,
        error: err.message || `Failed to ${decision.toLowerCase()} request.`,
      }));
    }
  };

  return (
    <div className="space-y-6 page-enter">
      {/* Page Header */}
      <PageHeader
        title="Student Suspension Requests"
        description="Review and adjudicate student appeals for KITS-EOS account restoration."
        action={
          <button
            type="button"
            onClick={fetchRequests}
            disabled={isLoading}
            className="px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-xs font-bold hover:bg-gray-50 transition shadow-2xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-kits-red' : ''}`} />
            <span>Refresh</span>
          </button>
        }
      />

      {/* Filter Tabs & Search Bar */}
      <div className="bg-white p-4 rounded-3xl border border-gray-200/80 shadow-2xs space-y-4">
        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 pb-3">
          {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((tab) => {
            const count = counts[tab];
            const isActive = statusTab === tab;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusTab(tab)}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer flex items-center gap-2 ${
                  isActive
                    ? 'bg-kits-red text-white shadow-2xs'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <span>{tab === 'ALL' ? 'All Requests' : tab}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by student name, roll number, or appeal message..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs text-gray-900 placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-kits-blue focus:border-kits-blue transition"
          />
        </div>
      </div>

      {/* Content Area */}
      {isLoading ? (
        <LoadingState message="Loading suspension requests..." />
      ) : error ? (
        <div className="p-5 bg-red-50 border border-red-200 rounded-3xl text-xs text-red-700 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : filteredRequests.length === 0 ? (
        <EmptyState
          title={
            statusTab === 'PENDING'
              ? 'No Pending Suspension Requests'
              : 'No Suspension Requests Found'
          }
          description={
            searchQuery.trim()
              ? 'No requests match your current search criteria.'
              : statusTab === 'PENDING'
              ? 'There are currently no student unsuspension requests awaiting administrative review.'
              : 'No requests recorded under this category.'
          }
          icon={<UserX className="h-6 w-6 text-gray-400" />}
        />
      ) : (
        <div className="bg-white rounded-3xl border border-gray-200/80 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50/80 border-b border-gray-100 text-[10px] font-black uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-5 py-3.5">Student</th>
                  <th className="px-4 py-3.5">Roll Number</th>
                  <th className="px-4 py-3.5">Department</th>
                  <th className="px-5 py-3.5">Suspension Reason</th>
                  <th className="px-5 py-3.5">Student Request</th>
                  <th className="px-4 py-3.5">Submitted</th>
                  <th className="px-4 py-3.5 text-center">Status</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredRequests.map((r) => {
                  const profile = r.student_profiles;
                  const isPending = r.status === 'PENDING';
                  const isApproved = r.status === 'APPROVED';
                  const isRejectedStatus = r.status === 'REJECTED';

                  return (
                    <tr key={r.id} className="hover:bg-gray-50/70 transition">
                      {/* Student Name */}
                      <td className="px-5 py-4 font-bold text-gray-900 whitespace-nowrap">
                        {profile?.full_name || '—'}
                      </td>

                      {/* Roll Number */}
                      <td className="px-4 py-4 font-mono font-bold text-gray-700 whitespace-nowrap">
                        {profile?.roll_number || '—'}
                      </td>

                      {/* Department */}
                      <td className="px-4 py-4 text-gray-600 whitespace-nowrap">
                        <span className="font-semibold text-gray-800">
                          {profile?.department || '—'}
                        </span>
                        {profile?.year_of_study ? (
                          <span className="text-gray-400"> • Yr {profile.year_of_study}</span>
                        ) : null}
                      </td>

                      {/* Suspension Reason */}
                      <td className="px-5 py-4 text-gray-700 max-w-xs truncate" title={profile?.suspension_reason || 'Platform rule violation'}>
                        <span className="text-red-700 font-medium">
                          {profile?.suspension_reason || 'Platform rule violation'}
                        </span>
                      </td>

                      {/* Student Request Message */}
                      <td className="px-5 py-4 text-gray-600 max-w-sm truncate" title={r.request_message}>
                        <span className="italic">"{r.request_message}"</span>
                      </td>

                      {/* Submitted Date */}
                      <td className="px-4 py-4 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                        {formatDateTime12h(r.created_at)}
                      </td>

                      {/* Status Badge */}
                      <td className="px-4 py-4 text-center whitespace-nowrap">
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="h-3 w-3" />
                            <span>PENDING</span>
                          </span>
                        )}
                        {isApproved && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>APPROVED</span>
                          </span>
                        )}
                        {isRejectedStatus && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-50 text-kits-red border border-red-200">
                            <XCircle className="h-3 w-3" />
                            <span>REJECTED</span>
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenReview(r)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-2xs flex items-center gap-1.5 ml-auto ${
                            isPending
                              ? 'bg-white border-2 border-kits-red text-kits-red hover:bg-red-50'
                              : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>{isPending ? 'Review' : 'View'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 bg-gray-50/70 border-t border-gray-100 text-xs text-gray-500">
            Showing {filteredRequests.length} of {requests.length} requests
          </div>
        </div>
      )}

      {/* =========================================================================
          REVIEW / ADJUDICATION MODAL
          ========================================================================= */}
      {reviewModal.open && reviewModal.request && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-gray-200 shadow-2xl max-w-lg w-full p-6 sm:p-7 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <UserX className="h-5 w-5 text-kits-red" />
                <h3 className="text-base font-black text-gray-900 tracking-tight">
                  {reviewModal.request.status === 'PENDING'
                    ? 'Review Unsuspension Request'
                    : 'Unsuspension Request Details'}
                </h3>
              </div>
              <button
                type="button"
                disabled={reviewModal.loading}
                onClick={handleCloseReview}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {reviewModal.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{reviewModal.error}</span>
              </div>
            )}

            {/* Student Information Details */}
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Student Name</span>
                  <span className="font-bold text-gray-800 text-sm block">
                    {reviewModal.request.student_profiles?.full_name || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Roll Number</span>
                  <span className="font-mono font-bold text-gray-800 text-sm block">
                    {reviewModal.request.student_profiles?.roll_number || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Department & Year</span>
                  <span className="font-semibold text-gray-700 block">
                    {reviewModal.request.student_profiles?.department || '—'} • Year{' '}
                    {reviewModal.request.student_profiles?.year_of_study || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Submitted On</span>
                  <span className="font-mono text-gray-700 block">
                    {formatDateTime12h(reviewModal.request.created_at)}
                  </span>
                </div>
              </div>

              {/* Official Suspension Reason */}
              <div className="pt-2 border-t border-gray-200/60">
                <span className="text-[10px] uppercase font-bold text-red-700 block mb-0.5">
                  Official Suspension Reason
                </span>
                <p className="text-xs font-semibold text-red-950 bg-red-50/60 p-2.5 rounded-xl border border-red-100">
                  {reviewModal.request.student_profiles?.suspension_reason || 'Platform rule violation'}
                </p>
              </div>

              {/* Student's Appeal Message */}
              <div className="pt-2 border-t border-gray-200/60">
                <span className="text-[10px] uppercase font-bold text-gray-500 block mb-0.5 flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  Student's Appeal Message
                </span>
                <p className="text-xs text-gray-800 bg-white p-3 rounded-xl border border-gray-200 italic leading-relaxed">
                  "{reviewModal.request.request_message}"
                </p>
              </div>
            </div>

            {/* If already resolved, show resolution summary */}
            {reviewModal.request.status !== 'PENDING' && (
              <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase text-gray-500">Resolution Status</span>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                      reviewModal.request.status === 'APPROVED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {reviewModal.request.status}
                  </span>
                </div>
                {reviewModal.request.reviewed_at && (
                  <span className="text-[10px] text-gray-400 font-mono block">
                    Reviewed on {formatDateTime12h(reviewModal.request.reviewed_at)}
                  </span>
                )}
                {reviewModal.request.admin_response && (
                  <div className="pt-1.5 border-t border-gray-200">
                    <span className="text-[10px] font-bold text-gray-500 block">Admin Feedback:</span>
                    <p className="text-gray-700 text-[11px] mt-0.5">
                      {reviewModal.request.admin_response}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* If PENDING: Decision Controls */}
            {reviewModal.request.status === 'PENDING' && (
              <div className="space-y-3 pt-1 border-t border-gray-100">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Admin Response / Reason (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={reviewModal.adminNote}
                    onChange={(e) => setReviewModal((prev) => ({ ...prev, adminNote: e.target.value }))}
                    placeholder="Provide an explanation or review note for the student..."
                    className="w-full px-3.5 py-2 border border-gray-300 rounded-xl text-xs text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-kits-blue focus:border-kits-blue resize-none transition"
                    maxLength={400}
                  />
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    disabled={reviewModal.loading}
                    onClick={handleCloseReview}
                    className="w-full sm:w-auto px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 transition cursor-pointer text-center"
                  >
                    Cancel
                  </button>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    {/* Reject Button */}
                    <button
                      type="button"
                      disabled={reviewModal.loading}
                      onClick={() => handleConfirmDecision('REJECTED')}
                      className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-white border-2 border-red-300 text-kits-red text-xs font-black uppercase tracking-wider hover:bg-red-50 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Reject Request</span>
                    </button>

                    {/* Approve & Unsuspend Button */}
                    <button
                      type="button"
                      disabled={reviewModal.loading}
                      onClick={() => handleConfirmDecision('APPROVED')}
                      className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-white border-2 border-emerald-600 text-emerald-700 text-xs font-black uppercase tracking-wider hover:bg-emerald-50 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Approve & Unsuspend</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
