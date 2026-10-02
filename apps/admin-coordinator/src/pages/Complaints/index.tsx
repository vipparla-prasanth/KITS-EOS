import { useState, useEffect, useRef } from 'react';
import { supabase } from '@kits-eos/shared/src/api/client';
import { useAuth } from '../../context/AuthContext';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { DeleteButton } from '../../components/ui/DeleteButton';
import { 
  AlertTriangle, 
  Search, 
  CheckCircle2, 
  X, 
  User,
  Trash2,
  RefreshCw,
  Check,
  ShieldAlert
} from 'lucide-react';
import type { Complaint } from '@kits-eos/shared/src/types/models';

export function ComplaintsList() {
  const { user } = useAuth();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Multi-selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const masterCheckboxRef = useRef<HTMLInputElement>(null);

  // Single complaint resolution modal
  const [activeComplaint, setActiveComplaint] = useState<Complaint | null>(null);
  const [resolutionText, setResolutionText] = useState('');
  const [targetStatus, setTargetStatus] = useState<'OPEN' | 'RESOLVED' | 'CLOSED'>('RESOLVED');
  const [isUpdating, setIsUpdating] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Bulk action modals
  const [isBulkSolveModalOpen, setIsBulkSolveModalOpen] = useState(false);
  const [isBulkSolving, setIsBulkSolving] = useState(false);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Feedback notifications
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchComplaints = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchErr } = await supabase
        .from('complaints')
        .select(`
          id,
          user_id,
          category,
          description,
          status,
          resolution,
          users (
            id,
            email
          )
        `)
        .order('id', { ascending: false });

      if (fetchErr) throw fetchErr;
      setComplaints((data as unknown as Complaint[]) || []);
    } catch (err: any) {
      console.error('Failed to load complaints:', err);
      setError(err.message || 'Failed to load complaints directory.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchComplaints();
  }, []);

  // Filtered dataset
  const filteredComplaints = complaints.filter((c) => {
    const q = searchTerm.toLowerCase();
    const userEmail = c.users?.email?.toLowerCase() || '';
    const matchesSearch = !q || 
      c.category.toLowerCase().includes(q) || 
      c.description.toLowerCase().includes(q) ||
      userEmail.includes(q);

    const matchesStatus = statusFilter === 'ALL' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Master checkbox selection logic
  const allVisibleSelected = filteredComplaints.length > 0 && filteredComplaints.every((c) => selectedIds.has(c.id));
  const someVisibleSelected = filteredComplaints.some((c) => selectedIds.has(c.id));
  const isIndeterminate = !allVisibleSelected && someVisibleSelected;

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      // Deselect all currently visible
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredComplaints.forEach((c) => next.delete(c.id));
        return next;
      });
    } else {
      // Select all currently visible
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredComplaints.forEach((c) => next.add(c.id));
        return next;
      });
    }
  };

  const handleToggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  // Open single resolution modal
  const handleOpenResolution = (c: Complaint) => {
    setActiveComplaint(c);
    setResolutionText(c.resolution || '');
    setTargetStatus(c.status);
    setModalError(null);
  };

  // Save single resolution
  const handleSaveResolution = async () => {
    if (!activeComplaint) return;

    try {
      setIsUpdating(true);
      setModalError(null);
      setActionError(null);

      const { error: updateErr } = await supabase
        .from('complaints')
        .update({
          status: targetStatus,
          resolution: resolutionText.trim() || null
        })
        .eq('id', activeComplaint.id);

      if (updateErr) throw updateErr;

      // Log audit
      await supabase.from('audit_logs').insert({
        actor_id: user?.id || null,
        action: 'COMPLAINT_UPDATED',
        entity_type: 'complaints',
        entity_id: activeComplaint.id,
        metadata: {
          previous_status: activeComplaint.status,
          new_status: targetStatus,
          resolved: targetStatus === 'RESOLVED'
        }
      });

      const updatedShortId = activeComplaint.id.slice(0, 8);
      setActiveComplaint(null);
      setActionSuccess(`Complaint #${updatedShortId} resolution updated successfully.`);
      await fetchComplaints();
    } catch (err: any) {
      console.error('Failed to update complaint resolution:', err);
      const safeMsg = err.message || err.error_description || 'Database permission error while updating complaint resolution.';
      setModalError(safeMsg);
    } finally {
      setIsUpdating(false);
    }
  };

  // Bulk Mark as Solved
  const handleBulkMarkAsSolved = async () => {
    if (selectedIds.size === 0) return;

    try {
      setIsBulkSolving(true);
      setActionError(null);
      setActionSuccess(null);

      const idsToUpdate = Array.from(selectedIds);

      const { error: updateErr } = await supabase
        .from('complaints')
        .update({
          status: 'RESOLVED'
        })
        .in('id', idsToUpdate);

      if (updateErr) throw updateErr;

      // Log audit entry
      await supabase.from('audit_logs').insert({
        actor_id: user?.id || null,
        action: 'COMPLAINTS_BULK_RESOLVED',
        entity_type: 'complaints',
        entity_id: idsToUpdate[0],
        metadata: {
          affected_count: idsToUpdate.length,
          complaint_ids: idsToUpdate,
          new_status: 'RESOLVED'
        }
      });

      const count = idsToUpdate.length;
      setSelectedIds(new Set());
      setIsBulkSolveModalOpen(false);
      setActionSuccess(`Successfully marked ${count} complaint${count > 1 ? 's' : ''} as solved.`);
      await fetchComplaints();
    } catch (err: any) {
      console.error('Failed to bulk resolve complaints:', err);
      setActionError(err.message || 'Failed to update selected complaints.');
    } finally {
      setIsBulkSolving(false);
    }
  };

  // Bulk Permanent Delete
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    try {
      setIsDeleting(true);
      setActionError(null);
      setActionSuccess(null);

      const idsToDelete = Array.from(selectedIds);

      const { error: deleteErr } = await supabase
        .from('complaints')
        .delete()
        .in('id', idsToDelete);

      if (deleteErr) throw deleteErr;

      // Log audit entry
      await supabase.from('audit_logs').insert({
        actor_id: user?.id || null,
        action: 'COMPLAINTS_BULK_DELETED',
        entity_type: 'complaints',
        entity_id: idsToDelete[0],
        metadata: {
          affected_count: idsToDelete.length,
          complaint_ids: idsToDelete
        }
      });

      const count = idsToDelete.length;
      setSelectedIds(new Set());
      setIsDeleteModalOpen(false);
      setActionSuccess(`Permanently deleted ${count} complaint record${count > 1 ? 's' : ''} from database.`);
      await fetchComplaints();
    } catch (err: any) {
      console.error('Failed to delete complaints:', err);
      setActionError(err.message || 'Failed to delete selected complaints from database.');
    } finally {
      setIsDeleting(false);
    }
  };

  const totalComplaints = complaints.length;
  const openCount = complaints.filter(c => c.status === 'OPEN').length;
  const resolvedCount = complaints.filter(c => c.status === 'RESOLVED').length;
  const closedCount = complaints.filter(c => c.status === 'CLOSED').length;

  if (isLoading) {
    return <LoadingState message="Loading Complaints & Grievances..." />;
  }

  return (
    <div className="space-y-6 sm:space-y-8 pb-16">
      <PageHeader
        title="Student Grievances & Complaints"
        description="Review reported issues, provide official resolutions, and manage ticket lifecycles."
      />

      {/* KPI Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Tickets</span>
          <p className="text-xl sm:text-2xl font-black text-gray-900 mt-0.5 sm:mt-1">{totalComplaints}</p>
          <span className="text-[10px] sm:text-[11px] text-gray-500 font-medium">All Grievances</span>
        </div>
        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Open Tickets</span>
          <p className="text-xl sm:text-2xl font-black text-amber-600 mt-0.5 sm:mt-1">{openCount}</p>
          <span className="text-[10px] sm:text-[11px] text-amber-700 font-medium">Action Required</span>
        </div>
        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Resolved</span>
          <p className="text-xl sm:text-2xl font-black text-emerald-600 mt-0.5 sm:mt-1">{resolvedCount}</p>
          <span className="text-[10px] sm:text-[11px] text-emerald-700 font-medium">Addressed</span>
        </div>
        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Closed</span>
          <p className="text-xl sm:text-2xl font-black text-gray-700 mt-0.5 sm:mt-1">{closedCount}</p>
          <span className="text-[10px] sm:text-[11px] text-gray-400 font-medium">Archived</span>
        </div>
      </div>

      {/* Global Alerts */}
      {actionSuccess && (
        <div className="p-3.5 sm:p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{actionSuccess}</span>
          </div>
          <button 
            onClick={() => setActionSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 p-1 rounded transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-3.5 sm:p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <span className="font-semibold">{actionError}</span>
          </div>
          <button 
            onClick={() => setActionError(null)}
            className="text-red-700 hover:text-red-900 p-1 rounded transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="bg-slate-900 text-white px-3.5 sm:px-5 py-3 rounded-2xl shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-slate-800 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-black text-xs">
              {selectedIds.size}
            </div>
            <span className="text-xs font-semibold text-slate-200">
              <strong className="text-white">{selectedIds.size}</strong> complaint{selectedIds.size > 1 ? 's' : ''} selected
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setIsBulkSolveModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-xs cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Mark as Solved</span>
            </button>

            <button
              type="button"
              onClick={() => setIsDeleteModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition shadow-xs cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete Selected</span>
            </button>

            <button
              type="button"
              onClick={handleClearSelection}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </div>
      )}

      {/* Complaints List Container */}
      <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        {/* Search & Filter Header */}
        <div className="p-3.5 sm:p-5 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
          <div className="relative w-full md:w-80">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search category, description, student email..."
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
            />
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-3 w-full md:w-auto">
            <div className="text-xs text-gray-500 font-medium">
              Showing <strong className="text-gray-900">{filteredComplaints.length}</strong> of {complaints.length}
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-lg px-3 py-2 cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="OPEN">Open Only</option>
              <option value="RESOLVED">Resolved Only</option>
              <option value="CLOSED">Closed Only</option>
            </select>
          </div>
        </div>

        {/* Master Selection Bar in Table Header */}
        <div className="bg-gray-50/80 px-4 sm:px-5 py-2.5 border-b border-gray-200 flex items-center justify-between gap-3 text-xs text-gray-600">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              ref={masterCheckboxRef}
              checked={allVisibleSelected}
              onChange={handleToggleSelectAll}
              className="h-4 w-4 rounded border-gray-300 text-kits-blue focus:ring-kits-blue cursor-pointer"
              aria-label="Select all visible complaints"
            />
            <span className="font-bold text-gray-700 text-xs">
              {allVisibleSelected ? 'Deselect All Visible' : 'Select All Visible'}
            </span>
          </label>

          <span className="text-[11px] text-gray-400 font-medium hidden sm:inline">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'None selected'}
          </span>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border-b border-red-200">
            <ErrorState message={error} />
          </div>
        )}

        {filteredComplaints.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-400">
            No complaints found matching the criteria.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredComplaints.map((c) => {
              const isSelected = selectedIds.has(c.id);

              return (
                <div 
                  key={c.id} 
                  className={`p-4 sm:p-5 transition flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4 ${
                    isSelected ? 'bg-blue-50/40' : 'hover:bg-gray-50/60'
                  }`}
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Row Checkbox */}
                    <div className="pt-0.5 shrink-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelectOne(c.id)}
                        className="h-4 w-4 rounded border-gray-300 text-kits-blue focus:ring-kits-blue cursor-pointer"
                        aria-label={`Select complaint ${c.id}`}
                      />
                    </div>

                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-xs uppercase px-2 py-0.5 rounded bg-gray-100 text-gray-800">
                          {c.category}
                        </span>
                        {c.status === 'OPEN' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <AlertTriangle className="h-3 w-3" /> Open
                          </span>
                        ) : c.status === 'RESOLVED' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" /> Resolved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
                            Closed
                          </span>
                        )}
                        <span className="text-[11px] font-mono text-gray-400">ID: {c.id.substring(0, 8)}</span>
                      </div>

                      <p className="text-xs text-gray-800 font-medium leading-relaxed break-words">
                        {c.description}
                      </p>

                      <div className="flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
                        <User className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <span className="break-all">Complainant: <span className="font-semibold text-gray-700">{c.users?.email || 'Student'}</span></span>
                      </div>

                      {c.resolution && (
                        <div className="p-3 bg-emerald-50/80 rounded-lg border border-emerald-200 text-xs text-emerald-900 space-y-1">
                          <span className="font-bold text-[10px] uppercase text-emerald-800 block">Official Resolution:</span>
                          <p className="break-words">{c.resolution}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="sm:self-start shrink-0 pt-1 sm:pt-0 pl-7 sm:pl-0">
                    <button
                      type="button"
                      onClick={() => handleOpenResolution(c)}
                      className="inline-flex items-center text-xs font-bold text-gray-700 bg-white border border-gray-300 px-3.5 py-1.5 rounded-lg hover:bg-gray-50 transition shadow-2xs cursor-pointer"
                    >
                      Manage / Resolve →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* =========================================================================
          SINGLE COMPLAINT RESOLUTION MODAL
          ========================================================================= */}
      {activeComplaint && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-2xl border border-gray-200 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-sm font-black uppercase text-gray-900">
                  Grievance Resolution
                </h3>
                <p className="text-[11px] font-mono text-gray-400">
                  Ticket #{activeComplaint.id.slice(0, 8)} • {activeComplaint.category}
                </p>
              </div>
              <button 
                type="button" 
                onClick={() => setActiveComplaint(null)} 
                className="p-1 hover:bg-gray-100 rounded-md transition"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-bold">Failed to update complaint resolution</p>
                  <p className="text-[11px] text-red-600 leading-relaxed break-words">{modalError}</p>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-gray-400">Issue Description:</span>
              <p className="text-xs text-gray-800 bg-gray-50 p-3 rounded-lg border border-gray-200 leading-relaxed break-words">
                {activeComplaint.description}
              </p>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <User className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <span>Complainant: <strong className="text-gray-800">{activeComplaint.users?.email || 'Student'}</strong></span>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                Ticket Status
              </label>
              <select
                value={targetStatus}
                onChange={(e) => setTargetStatus(e.target.value as any)}
                className="w-full bg-white border border-gray-300 text-gray-900 text-xs font-bold rounded-lg p-2.5 cursor-pointer"
              >
                <option value="OPEN">OPEN (Awaiting Action)</option>
                <option value="RESOLVED">RESOLVED (Action Taken)</option>
                <option value="CLOSED">CLOSED (Archived)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                Official Resolution Notes
              </label>
              <textarea
                rows={4}
                value={resolutionText}
                onChange={(e) => setResolutionText(e.target.value)}
                placeholder="Explain the actions taken to resolve this grievance..."
                className="w-full bg-white border border-gray-300 text-gray-900 text-xs rounded-lg p-3 focus:ring-1 focus:ring-kits-blue"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setActiveComplaint(null)}
                disabled={isUpdating}
                className="px-4 py-2 rounded-lg border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveResolution}
                disabled={isUpdating}
                className="px-5 py-2 rounded-lg bg-kits-blue text-white text-xs font-bold uppercase shadow-sm hover:bg-blue-800 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {isUpdating && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>{isUpdating ? 'Saving...' : 'Save Resolution'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          BULK MARK AS SOLVED CONFIRMATION MODAL
          ========================================================================= */}
      {isBulkSolveModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-2xl border border-gray-200 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center gap-3 border-b border-gray-100 pb-3">
              <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl shrink-0 border border-emerald-100">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase text-gray-900">
                  Mark Selected Complaints as Solved?
                </h3>
                <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">
                  Bulk Resolution
                </p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-gray-600 leading-relaxed">
              <p className="font-semibold text-gray-900">
                This will update the status of <strong className="text-emerald-700">{selectedIds.size} selected complaint{selectedIds.size > 1 ? 's' : ''}</strong> to <strong className="text-emerald-700">RESOLVED</strong>.
              </p>
              <p className="text-gray-500">
                The complaints will be addressed in the database and the dashboard statistics will refresh immediately.
              </p>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                disabled={isBulkSolving}
                onClick={() => setIsBulkSolveModalOpen(false)}
                className="w-full sm:w-auto px-4 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-50 text-center"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBulkSolving}
                onClick={handleBulkMarkAsSolved}
                className="w-full sm:w-auto px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition shadow-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isBulkSolving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>{isBulkSolving ? 'Updating...' : 'Mark as Solved'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          BULK PERMANENT DELETION CONFIRMATION MODAL
          ========================================================================= */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-2xl border border-gray-200 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center gap-3 border-b border-gray-100 pb-3">
              <div className="p-2.5 bg-red-50 text-red-600 rounded-xl shrink-0 border border-red-100">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase text-gray-900">
                  Permanently Delete Complaints?
                </h3>
                <p className="text-[11px] text-red-500 font-bold uppercase tracking-wider">
                  Destructive Database Action
                </p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-gray-600 leading-relaxed">
              <p className="font-semibold text-gray-900">
                You are about to permanently delete <strong className="text-red-600">{selectedIds.size} complaint record{selectedIds.size > 1 ? 's' : ''}</strong>.
              </p>
              <p className="text-gray-500">
                This action cannot be undone. The selected records will be permanently removed from the live database.
              </p>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setIsDeleteModalOpen(false)}
                className="w-full sm:w-auto px-4 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-50 text-center"
              >
                Cancel
              </button>
              <DeleteButton
                disabled={isDeleting}
                loading={isDeleting}
                onClick={handleBulkDelete}
                className="w-full sm:w-auto px-5 py-2 rounded-xl"
                label="Delete Permanently"
                loadingLabel="Deleting..."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
