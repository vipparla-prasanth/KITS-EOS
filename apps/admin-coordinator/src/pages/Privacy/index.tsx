import { useState, useEffect } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { 
  ShieldCheck, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink,
  User
} from 'lucide-react';
import type { PrivacyRequest, PrivacyRequestStatus } from '@kits-eos/shared/src/types/models';

interface EnrichedPrivacyRequest extends PrivacyRequest {
  user_email?: string;
  student_name?: string;
  student_roll?: string;
  student_dept?: string;
}

export function PrivacyManagement() {
  const [requests, setRequests] = useState<EnrichedPrivacyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    underReview: 0,
    completed: 0,
    totalStudents: 0,
    acknowledgedCount: 0
  });

  // Filters & Tabs
  const [activeTab, setActiveTab] = useState<'REQUESTS' | 'GOVERNANCE' | 'CATEGORIES' | 'AUDIT'>('REQUESTS');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Resolution Modal
  const [activeRequest, setActiveRequest] = useState<EnrichedPrivacyRequest | null>(null);
  const [targetStatus, setTargetStatus] = useState<PrivacyRequestStatus>('COMPLETED');
  const [adminNotes, setAdminNotes] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Privacy / Security Audit Logs
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  const fetchPrivacyData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 1. Fetch privacy requests
      const { data: reqData, error: reqErr } = await supabase
        .from('privacy_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (reqErr) throw reqErr;

      // 2. Fetch student profiles and emails to enrich
      const userIds = Array.from(new Set((reqData || []).map(r => r.user_id)));
      let studentMap: Record<string, any> = {};
      let userMap: Record<string, string> = {};

      if (userIds.length > 0) {
        const [profilesRes, usersRes] = await Promise.all([
          supabase.from('student_profiles').select('user_id, full_name, roll_number, department').in('user_id', userIds),
          supabase.from('users').select('id, email').in('id', userIds)
        ]);

        if (profilesRes.data) {
          profilesRes.data.forEach(p => {
            studentMap[p.user_id] = p;
          });
        }
        if (usersRes.data) {
          usersRes.data.forEach(u => {
            userMap[u.id] = u.email;
          });
        }
      }

      const enriched: EnrichedPrivacyRequest[] = (reqData || []).map(r => ({
        ...r,
        user_email: userMap[r.user_id] || 'Unknown',
        student_name: studentMap[r.user_id]?.full_name || 'Student',
        student_roll: studentMap[r.user_id]?.roll_number || 'N/A',
        student_dept: studentMap[r.user_id]?.department || 'N/A'
      }));

      setRequests(enriched);

      // 3. Calculate statistics
      const pendingCount = enriched.filter(r => r.status === 'PENDING').length;
      const underReviewCount = enriched.filter(r => r.status === 'UNDER_REVIEW').length;
      const completedCount = enriched.filter(r => r.status === 'COMPLETED').length;

      // 4. Fetch student acknowledgement counts
      const { data: allStudents } = await supabase
        .from('student_profiles')
        .select('user_id, privacy_acknowledged_at');

      const totalStudents = allStudents?.length || 0;
      const acknowledgedCount = allStudents?.filter(s => Boolean(s.privacy_acknowledged_at)).length || 0;

      setStats({
        total: enriched.length,
        pending: pendingCount,
        underReview: underReviewCount,
        completed: completedCount,
        totalStudents,
        acknowledgedCount
      });

    } catch (err: any) {
      console.error('Failed to load privacy management data:', err);
      setError(err.message || 'Failed to load privacy requests.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      setIsLoadingAudit(true);
      const { data, error: logErr } = await supabase
        .from('audit_logs')
        .select('*')
        .or('action.ilike.%PRIVACY%,action.ilike.%SECURITY%,action.ilike.%DELETE%')
        .order('created_at', { ascending: false })
        .limit(40);

      if (logErr) throw logErr;
      setAuditLogs(data || []);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setIsLoadingAudit(false);
    }
  };

  useEffect(() => {
    fetchPrivacyData();
  }, []);

  useEffect(() => {
    if (activeTab === 'AUDIT') {
      fetchAuditLogs();
    }
  }, [activeTab]);

  const handleOpenResolutionModal = (req: EnrichedPrivacyRequest) => {
    setActiveRequest(req);
    setTargetStatus(req.status === 'PENDING' ? 'UNDER_REVIEW' : req.status);
    setAdminNotes(req.admin_notes || '');
    setModalError(null);
  };

  const handleSaveResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRequest) return;

    try {
      setIsUpdating(true);
      setModalError(null);

      const { data, error: rpcErr } = await supabase.rpc('admin_update_privacy_request', {
        p_request_id: activeRequest.id,
        p_status: targetStatus,
        p_admin_notes: adminNotes.trim() || null
      });

      if (rpcErr) throw rpcErr;
      if (!data?.success) throw new Error(data?.error || 'Failed to update privacy request.');

      setActionSuccess(`Privacy request status updated to ${targetStatus}.`);
      setActiveRequest(null);
      await fetchPrivacyData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      console.error('Failed to update privacy request:', err);
      setModalError(err.message || 'Failed to update request.');
    } finally {
      setIsUpdating(false);
    }
  };

  const filteredRequests = requests.filter(req => {
    const matchesStatus = statusFilter === 'ALL' || req.status === statusFilter;
    const matchesType = typeFilter === 'ALL' || req.request_type === typeFilter;
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch = !term || 
      req.student_name?.toLowerCase().includes(term) ||
      req.student_roll?.toLowerCase().includes(term) ||
      req.user_email?.toLowerCase().includes(term) ||
      req.description.toLowerCase().includes(term);

    return matchesStatus && matchesType && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* 1. Page Header */}
      <PageHeader
        title="Privacy & Data Protection"
        description="Institutional governance aligned with India's Digital Personal Data Protection Act, 2023 (DPDP Act)."
        action={
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 transition shadow-2xs"
          >
            <span>View Public Notice</span>
            <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
          </a>
        }
      />

      {/* 2. Success/Error Alerts */}
      {actionSuccess && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-600 hover:text-emerald-800">✕</button>
        </div>
      )}

      {/* 3. Metrics Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Total Requests</span>
          <div className="text-2xl font-black text-gray-900">{stats.total}</div>
          <p className="text-[11px] text-gray-500">Submitted privacy inquiries</p>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-black uppercase tracking-wider text-amber-600">Pending Action</span>
          <div className="text-2xl font-black text-amber-600">{stats.pending}</div>
          <p className="text-[11px] text-gray-500">Awaiting administrator review</p>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-black uppercase tracking-wider text-blue-600">Under Review</span>
          <div className="text-2xl font-black text-blue-600">{stats.underReview}</div>
          <p className="text-[11px] text-gray-500">In institutional evaluation</p>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Notice Acknowledgement</span>
          <div className="text-2xl font-black text-emerald-600">
            {stats.acknowledgedCount} <span className="text-xs text-gray-400 font-normal">/ {stats.totalStudents}</span>
          </div>
          <p className="text-[11px] text-gray-500">
            {stats.totalStudents > 0 ? `${Math.round((stats.acknowledgedCount / stats.totalStudents) * 100)}% acknowledged` : 'No students'}
          </p>
        </div>
      </div>

      {/* 4. Tab Navigation Strip */}
      <div className="flex border-b border-gray-200 gap-2 overflow-x-auto text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveTab('REQUESTS')}
          className={`pb-3 px-3 transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'REQUESTS'
              ? 'border-kits-red text-kits-red font-black'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          Privacy Requests ({requests.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('GOVERNANCE')}
          className={`pb-3 px-3 transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'GOVERNANCE'
              ? 'border-kits-red text-kits-red font-black'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          Notice & Grievance Governance
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('CATEGORIES')}
          className={`pb-3 px-3 transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'CATEGORIES'
              ? 'border-kits-red text-kits-red font-black'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          Personal Data Matrix
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('AUDIT')}
          className={`pb-3 px-3 transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'AUDIT'
              ? 'border-kits-red text-kits-red font-black'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          Security & Privacy Audit Logs
        </button>
      </div>

      {/* TAB 1: PRIVACY REQUESTS WORKFLOW */}
      {activeTab === 'REQUESTS' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-2xs flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by student, roll no, or details..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-gray-300 rounded-xl focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white text-gray-700 font-semibold"
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="UNDER_REVIEW">Under Review</option>
                <option value="COMPLETED">Completed</option>
                <option value="REJECTED">Rejected</option>
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white text-gray-700 font-semibold"
              >
                <option value="ALL">All Request Types</option>
                <option value="DATA_ACCESS">Data Access</option>
                <option value="DATA_CORRECTION">Data Correction</option>
                <option value="DATA_DELETION">Data Deletion Review</option>
                <option value="DATA_PORTABILITY">Data Portability</option>
                <option value="OTHER">Other Inquiries</option>
              </select>
            </div>
          </div>

          {/* Requests Table */}
          {isLoading ? (
            <LoadingState message="Loading privacy requests..." />
          ) : error ? (
            <ErrorState message={error} onRetry={fetchPrivacyData} />
          ) : filteredRequests.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-dashed border-gray-200 text-xs text-gray-400">
              No privacy requests matching the selected filters.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-black uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="p-4">Student</th>
                      <th className="p-4">Type</th>
                      <th className="p-4">Description</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Submitted</th>
                      <th className="p-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                    {filteredRequests.map(req => (
                      <tr key={req.id} className="hover:bg-gray-50/50 transition">
                        <td className="p-4">
                          <div className="font-bold text-gray-900">{req.student_name}</div>
                          <div className="text-[11px] font-mono text-gray-500">{req.student_roll}</div>
                          <div className="text-[10px] text-gray-400 truncate max-w-xs">{req.user_email}</div>
                        </td>

                        <td className="p-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-gray-100 text-gray-800">
                            {req.request_type.replace('_', ' ')}
                          </span>
                        </td>

                        <td className="p-4 max-w-md">
                          <p className="line-clamp-2 text-gray-800">{req.description}</p>
                          {req.admin_notes && (
                            <p className="text-[10px] text-blue-700 font-medium mt-1">
                              <strong>Note:</strong> {req.admin_notes}
                            </p>
                          )}
                        </td>

                        <td className="p-4 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            req.status === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : req.status === 'UNDER_REVIEW'
                              ? 'bg-blue-100 text-blue-800'
                              : req.status === 'REJECTED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {req.status.replace('_', ' ')}
                          </span>
                        </td>

                        <td className="p-4 whitespace-nowrap text-gray-500 text-[11px]">
                          {new Date(req.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </td>

                        <td className="p-4 whitespace-nowrap text-right">
                          <button
                            type="button"
                            onClick={() => handleOpenResolutionModal(req)}
                            className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 active:scale-95 transition cursor-pointer"
                          >
                            Review & Update
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: NOTICE & GRIEVANCE GOVERNANCE */}
      {activeTab === 'GOVERNANCE' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
              <ShieldCheck className="h-5 w-5 text-kits-blue" />
              <h3 className="text-sm font-black text-gray-900 tracking-tight">
                Active Privacy Notice Configuration
              </h3>
            </div>

            <div className="space-y-3 text-xs text-gray-700">
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">Active Notice Version</span>
                <span className="font-mono font-bold text-gray-900">Version 1.0</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">Effective Date</span>
                <span className="font-bold text-gray-900">September 2026</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">Legal Reference</span>
                <span className="font-bold text-gray-900">Digital Personal Data Protection Act, 2023 (DPDP)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">Existing Users Handled</span>
                <span className="font-bold text-emerald-700">Strict Non-Destructive (NULL initial state)</span>
              </div>
            </div>

            <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-[11px] text-blue-950 leading-relaxed">
              <strong>Notice Versioning Principle:</strong> When a major privacy notice change is promulgated, 
              historical acknowledgement records are retained. Existing students receive an acknowledgement prompt upon next profile review.
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
              <User className="h-5 w-5 text-kits-red" />
              <h3 className="text-sm font-black text-gray-900 tracking-tight">
                Institutional Grievance Contact
              </h3>
            </div>

            <div className="space-y-3 text-xs text-gray-700">
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">Responsible Cell</span>
                <span className="font-bold text-gray-900">KITS-EOS Event Operations Cell</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">Host Institution</span>
                <span className="font-bold text-gray-900">KITS Akshar Institute of Technology</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">Official Channel</span>
                <span className="font-bold text-gray-900">Campus Administration Office / Portal Request</span>
              </div>
            </div>

            <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200 text-[11px] text-amber-950 leading-relaxed">
              <strong>Institutional Policy Note:</strong> In accordance with strict guidelines, no unverified personal emails or phone numbers are published. 
              All student inquiries are routed through the governed Privacy Request queue.
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PERSONAL DATA MATRIX */}
      {activeTab === 'CATEGORIES' && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-black text-gray-900 tracking-tight">
              Documented Personal Data Inventory & Retention Policy
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Summary of all personal data categories, operational purposes, and retention justification.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-black uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="p-4">Data Category</th>
                  <th className="p-4">Collected Fields</th>
                  <th className="p-4">Operational Purpose</th>
                  <th className="p-4">Access Scope</th>
                  <th className="p-4">Retention Baseline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                <tr>
                  <td className="p-4 font-bold text-gray-900">Student Identity</td>
                  <td className="p-4 text-gray-600">Full Name, Roll Number, College, Department, Year</td>
                  <td className="p-4">Participant authentication, eligibility validation</td>
                  <td className="p-4">Student (own), Assigned Coordinator, Admin</td>
                  <td className="p-4 text-gray-500">Active academic enrollment</td>
                </tr>
                <tr>
                  <td className="p-4 font-bold text-gray-900">Contact Details</td>
                  <td className="p-4 text-gray-600">10-digit Indian Mobile Number, Email Address</td>
                  <td className="p-4">Event alerts, emergency contact, WhatsApp fallback</td>
                  <td className="p-4">Student (own), Assigned Coordinator, Admin</td>
                  <td className="p-4 text-gray-500">Active event lifecycle</td>
                </tr>
                <tr>
                  <td className="p-4 font-bold text-gray-900">Registrations & Teams</td>
                  <td className="p-4 text-gray-600">Team Name, Sub-event, Role, Leader flag</td>
                  <td className="p-4">Competition scheduling, category quota management</td>
                  <td className="p-4">Student (own), Assigned Coordinator, Admin</td>
                  <td className="p-4 text-gray-500">Institutional event records</td>
                </tr>
                <tr>
                  <td className="p-4 font-bold text-gray-900">Attendance Records</td>
                  <td className="p-4 text-gray-600">Venue check-in timestamp, Coordinator stamp</td>
                  <td className="p-4">Physical verification, certificate eligibility</td>
                  <td className="p-4">Student (own), Assigned Coordinator, Admin</td>
                  <td className="p-4 text-gray-500">Institutional accreditation audit (NAAC)</td>
                </tr>
                <tr>
                  <td className="p-4 font-bold text-gray-900">Payments & Accounting</td>
                  <td className="p-4 text-gray-600">Amount, Payment Method (UPI/COD), Reference ID</td>
                  <td className="p-4">Fee reconciliation, financial audits</td>
                  <td className="p-4">Student (own), Admin</td>
                  <td className="p-4 text-gray-500">Statutory accounting period</td>
                </tr>
                <tr>
                  <td className="p-4 font-bold text-gray-900">Uploaded Documents</td>
                  <td className="p-4 text-gray-600">Abstract files, PPTs, verification attachments</td>
                  <td className="p-4">Sub-event prerequisite evaluation</td>
                  <td className="p-4">Student (own), Assigned Coordinator (300s signed URL), Admin</td>
                  <td className="p-4 text-gray-500">Defined institutional competition period</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: SECURITY & PRIVACY AUDIT LOGS */}
      {activeTab === 'AUDIT' && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-gray-900 tracking-tight">
                Security & Privacy Audit Trail
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Authoritative event log for privacy acknowledgements, exports, and administrator reviews.
              </p>
            </div>
            <button
              onClick={fetchAuditLogs}
              className="text-xs font-bold text-kits-blue hover:underline cursor-pointer"
            >
              Refresh Logs
            </button>
          </div>

          {isLoadingAudit ? (
            <div className="p-8 text-center text-xs text-gray-400">Loading audit trail...</div>
          ) : auditLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400">No recent security or privacy events recorded.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-black uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Entity Type</th>
                    <th className="p-3">Entity ID</th>
                    <th className="p-3">Metadata</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-mono text-[11px] text-gray-700">
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-gray-50/50 transition">
                      <td className="p-3 whitespace-nowrap text-gray-500">
                        {new Date(log.created_at).toLocaleString('en-IN')}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-800">
                          {log.action}
                        </span>
                      </td>
                      <td className="p-3 text-gray-600">{log.entity_type}</td>
                      <td className="p-3 text-gray-400 truncate max-w-xs">{log.entity_id}</td>
                      <td className="p-3 text-gray-600 font-sans text-xs truncate max-w-md">
                        {JSON.stringify(log.metadata || {})}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* RESOLUTION MODAL */}
      {activeRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-3xl border border-gray-200 max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-black text-gray-900 tracking-tight">
                Review Privacy Request
              </h3>
              <button
                type="button"
                onClick={() => setActiveRequest(null)}
                className="text-gray-400 hover:text-gray-600 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {/* Student Context Card */}
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="font-bold text-gray-900">{activeRequest.student_name}</span>
                <span className="font-mono text-gray-600">{activeRequest.student_roll}</span>
              </div>
              <div className="text-[11px] text-gray-500">{activeRequest.user_email} • {activeRequest.student_dept}</div>
            </div>

            {/* Request Details */}
            <div className="space-y-1">
              <div className="text-[10px] font-black uppercase tracking-wider text-gray-400">
                Request Details ({activeRequest.request_type})
              </div>
              <p className="p-3 bg-white border border-gray-200 rounded-xl text-xs text-gray-800 leading-relaxed">
                {activeRequest.description}
              </p>
            </div>

            <form onSubmit={handleSaveResolution} className="space-y-4 text-xs font-semibold text-gray-700">
              <div>
                <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-600 mb-1">
                  Update Request Status <span className="text-red-500">*</span>
                </label>
                <select
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value as PrivacyRequestStatus)}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 bg-white focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                >
                  <option value="UNDER_REVIEW">UNDER_REVIEW (Institutional investigation ongoing)</option>
                  <option value="COMPLETED">COMPLETED (Action resolved or verified)</option>
                  <option value="REJECTED">REJECTED (Request invalid or retention required)</option>
                  <option value="PENDING">PENDING (Reset to pending)</option>
                </select>
              </div>

              <div>
                <label className="block uppercase text-[10px] font-extrabold tracking-wider text-gray-600 mb-1">
                  Institutional Resolution Notes
                </label>
                <textarea
                  rows={3}
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="Enter resolution notes visible to the student..."
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveRequest(null)}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-5 py-2.5 rounded-xl bg-kits-blue text-white text-xs font-bold hover:bg-blue-800 disabled:opacity-50 transition cursor-pointer"
                >
                  {isUpdating ? 'Saving...' : 'Save Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
