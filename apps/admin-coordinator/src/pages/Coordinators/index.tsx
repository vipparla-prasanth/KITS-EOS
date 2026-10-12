import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, invokeAdminEdgeFunction } from '@kits-eos/shared';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { exportToExcel, exportTableToPNG } from '@kits-eos/shared/src/utils/export';
import { DownloadButton } from '../../components/ui/DownloadButton';
import { DeleteButton } from '../../components/ui/DeleteButton';
import type { CoordinatorAssignment } from '@kits-eos/shared/src/types/models';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { 
  UserCog, 
  Search, 
  Phone, 
  GraduationCap, 
  UserCheck, 
  ExternalLink,
  Layers,
  Calendar,
  KeyRound,
  Trash2,
  Download,
  X,
  CheckCircle2,
  ShieldAlert,
  FileSpreadsheet,
  Image as ImageIcon,
  AlertCircle
} from 'lucide-react';

export function CoordinatorsList() {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<CoordinatorAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'FACULTY' | 'STUDENT'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL');

  // Export Modal States
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'FILTERED' | 'ENTIRE'>('FILTERED');
  const [exportFormat, setExportFormat] = useState<'EXCEL' | 'PNG'>('EXCEL');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Password Reset & Delete Modal States
  const [resetCoord, setResetCoord] = useState<{ id: string; username: string; display_name: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const [deleteCoord, setDeleteCoord] = useState<{ id: string; username: string; display_name: string; assignmentCount: number } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function fetchCoordinators() {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: err } = await supabase
        .from('coordinator_assignments')
        .select(`
          id,
          coordinator_id,
          sub_event_id,
          coordinators (
            id,
            username,
            display_name,
            phone_number,
            contact_visible,
            coordinator_type,
            status,
            created_at
          ),
          sub_events (
            id,
            name,
            category_id,
            event_id,
            status,
            categories (
              id,
              name,
              event_id,
              events (
                id,
                name
              )
            ),
            events (
              id,
              name
            )
          )
        `)
        .order('id', { ascending: false });

      if (err) throw err;
      setAssignments((data as unknown as CoordinatorAssignment[]) || []);
    } catch (err: any) {
      console.error('Failed to fetch coordinators:', err);
      setError(err.message || 'An unexpected error occurred while loading coordinators.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchCoordinators();
  }, []);

  // Filtered list
  const filteredAssignments = useMemo(() => {
    return assignments.filter((item) => {
      const coord = item.coordinators;
      const sub = item.sub_events;
      if (!coord) return false;

      // Type filter
      if (typeFilter !== 'ALL') {
        const type = (coord.coordinator_type || 'FACULTY').toUpperCase();
        if (type !== typeFilter) return false;
      }

      // Status filter
      if (statusFilter !== 'ALL') {
        if (coord.status !== statusFilter) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = coord.display_name.toLowerCase().includes(q);
        const usernameMatch = coord.username.toLowerCase().includes(q);
        const phoneMatch = coord.phone_number?.toLowerCase().includes(q) || false;
        const subEventMatch = sub?.name?.toLowerCase().includes(q) || false;
        const categoryMatch = sub?.categories?.name?.toLowerCase().includes(q) || false;
        const eventMatch = (sub?.events?.name || sub?.categories?.events?.name)?.toLowerCase().includes(q) || false;

        return nameMatch || usernameMatch || phoneMatch || subEventMatch || categoryMatch || eventMatch;
      }

      return true;
    });
  }, [assignments, searchQuery, typeFilter, statusFilter]);

  // Handle Export Execution
  const handleExecuteExport = async () => {
    try {
      setExportError(null);
      setExportSuccess(null);

      await fetchCoordinators();

      const dataset = exportScope === 'FILTERED' ? filteredAssignments : assignments;

      if (dataset.length === 0) {
        setExportError('No coordinator records match the selection.');
        return;
      }

      const headers = [
        'S.No',
        'Coordinator Name',
        'Username',
        'Role',
        'Contact Number',
        'Assigned Sub-Event',
        'Category',
        'Flagship Event',
        'Status',
      ];

      const rows = dataset.map((a, idx) => {
        const c = a.coordinators;
        const sub = a.sub_events;
        const eventName = sub?.events?.name || sub?.categories?.events?.name || 'Main Event';
        const categoryName = sub?.categories?.name || 'General';

        return [
          idx + 1,
          c?.display_name || 'N/A',
          `@${c?.username || 'user'}`,
          (c?.coordinator_type || 'FACULTY').toUpperCase() === 'FACULTY' ? 'Faculty Coordinator' : 'Student Coordinator',
          c?.phone_number || 'N/A',
          sub?.name || 'Unassigned',
          categoryName,
          eventName,
          c?.status || 'ACTIVE',
        ];
      });

      const dateStr = new Date().toISOString().split('T')[0];

      if (exportFormat === 'EXCEL') {
        await exportToExcel({
          filename: `KITS_EOS_Admin_Coordinators_${exportScope === 'FILTERED' ? 'Filtered_' : 'All_'}${dateStr}.xlsx`,
          title: 'ADMIN EVENT COORDINATORS DIRECTORY',
          subtitle: exportScope === 'FILTERED' ? `Filtered (${dataset.length} Assignments)` : `Full Directory (${dataset.length} Assignments)`,
          headers,
          rows,
          colWidths: [8, 22, 16, 20, 16, 20, 18, 20, 12],
        });
        setExportSuccess('Excel spreadsheet downloaded successfully!');
      } else {
        await exportTableToPNG({
          filename: `KITS_EOS_Admin_Coordinators_${exportScope === 'FILTERED' ? 'Filtered_' : 'All_'}${dateStr}.png`,
          title: 'ADMIN EVENT COORDINATORS DIRECTORY',
          subtitle: exportScope === 'FILTERED' ? `Filtered (${dataset.length} Assignments)` : `Full Directory (${dataset.length} Assignments)`,
          headers,
          rows,
          colWidths: [8, 20, 15, 18, 15, 18, 16, 18, 12],
          rowsPerPage: 25,
        });
        setExportSuccess('PNG document table downloaded successfully!');
      }

      setTimeout(() => {
        setIsExportModalOpen(false);
        setExportSuccess(null);
      }, 1800);
    } catch (err: any) {
      console.error('Coordinator export error:', err);
      setExportError(err.message || 'Failed to generate export file.');
    }
  };

  // Handle Reset Coordinator Password
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetCoord) return;
    setResetError(null);
    setResetMessage(null);

    if (newPassword.length < 6) {
      setResetError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match.');
      return;
    }

    try {
      setResetLoading(true);
      const { data, error: fnError } = await invokeAdminEdgeFunction('admin-manage-account', {
        body: {
          action: 'reset_coordinator_password',
          coordinator_id: resetCoord.id,
          new_password: newPassword,
        },
      });

      if (fnError || !data?.success) {
        throw new Error(data?.error?.message || fnError?.message || 'Failed to reset coordinator password');
      }

      setResetMessage(`Password successfully updated for ${resetCoord.display_name}.`);
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setResetCoord(null);
        setResetMessage(null);
      }, 2000);
    } catch (err: any) {
      console.error('Coordinator password reset failure:', err);
      setResetError(err.message || 'Failed to reset coordinator password.');
    } finally {
      setResetLoading(false);
    }
  };

  // Handle Delete Coordinator
  const handleDeleteCoordinatorSubmit = async () => {
    if (!deleteCoord || deleteConfirmText.trim() !== 'DELETE') return;
    setDeleteError(null);

    try {
      setDeleteLoading(true);
      const { data, error: fnError } = await invokeAdminEdgeFunction('admin-manage-account', {
        body: {
          action: 'delete_coordinator',
          coordinator_id: deleteCoord.id,
        },
      });

      if (fnError || !data?.success) {
        throw new Error(data?.error?.message || fnError?.message || 'Failed to delete coordinator');
      }

      setDeleteCoord(null);
      setDeleteConfirmText('');
      await fetchCoordinators();
    } catch (err: any) {
      console.error('Coordinator deletion failure:', err);
      setDeleteError(err.message || 'Failed to delete coordinator.');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Metric aggregates
  const facultyCount = assignments.filter(a => (a.coordinators?.coordinator_type || 'FACULTY').toUpperCase() === 'FACULTY').length;
  const studentCount = assignments.filter(a => (a.coordinators?.coordinator_type || '').toUpperCase() === 'STUDENT').length;
  const totalCoordinators = assignments.length;

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Event Coordinators Management"
          description="Inspect faculty and student coordinators assigned across events, manage access passwords, and export coordinator records."
        />
        <button
          type="button"
          onClick={() => {
            setIsExportModalOpen(true);
            setExportError(null);
            setExportSuccess(null);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-wider hover:bg-gray-800 transition shadow-2xs cursor-pointer self-start sm:self-auto"
        >
          <Download className="h-4 w-4 text-kits-blue" />
          <span>Download Directory</span>
        </button>
      </div>

      {/* KPI Metric Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-2xs flex items-center gap-4">
          <div className="p-3 bg-red-50 text-kits-red rounded-lg">
            <UserCog className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total Assignments</p>
            <p className="text-2xl font-black text-gray-900">{totalCoordinators}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-2xs flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-kits-blue rounded-lg">
            <UserCheck className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Faculty Coordinators</p>
            <p className="text-2xl font-black text-kits-blue">{facultyCount}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-2xs flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <GraduationCap className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Student Coordinators</p>
            <p className="text-2xl font-black text-emerald-700">{studentCount}</p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by Coordinator Name, Username, Phone, or Sub-event..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-kits-red focus:border-kits-red"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="bg-white border border-gray-300 text-gray-700 text-xs font-bold rounded-lg px-3 py-2 focus:ring-1 focus:ring-kits-red focus:border-kits-red"
          >
            <option value="ALL">All Roles</option>
            <option value="FACULTY">Faculty Only</option>
            <option value="STUDENT">Student Only</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-white border border-gray-300 text-gray-700 text-xs font-bold rounded-lg px-3 py-2 focus:ring-1 focus:ring-kits-red focus:border-kits-red"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
      </div>

      {/* Coordinators Table / View */}
      {isLoading ? (
        <LoadingState message="Loading coordinator directory..." />
      ) : error ? (
        <ErrorState message={error} />
      ) : filteredAssignments.length === 0 ? (
        <EmptyState
          title="No Coordinators Found"
          description={searchQuery || typeFilter !== 'ALL' ? "No coordinators match your current filter criteria." : "No coordinators have been assigned to any sub-events yet. Assign coordinators when creating or editing sub-events."}
          icon={<UserCog className="h-8 w-8 text-gray-400" />}
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] font-extrabold tracking-wider">
                <tr>
                  <th scope="col" className="px-6 py-3.5">Coordinator</th>
                  <th scope="col" className="px-6 py-3.5">Role</th>
                  <th scope="col" className="px-6 py-3.5">Contact Number</th>
                  <th scope="col" className="px-6 py-3.5">Assigned Sub-Event & Scope</th>
                  <th scope="col" className="px-6 py-3.5">Status</th>
                  <th scope="col" className="px-6 py-3.5">Assigned On</th>
                  <th scope="col" className="px-6 py-3.5 text-right">Account Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredAssignments.map((assignment) => {
                  const coord = assignment.coordinators!;
                  const sub = assignment.sub_events;
                  const isFaculty = (coord.coordinator_type || 'FACULTY').toUpperCase() === 'FACULTY';
                  const eventName = sub?.events?.name || sub?.categories?.events?.name || 'Main Event';
                  const categoryName = sub?.categories?.name;

                  const subEventUrl = sub?.category_id
                    ? `/admin/events/${sub.categories?.event_id || sub.categories?.events?.id}/categories/${sub.category_id}/sub-events/${sub.id}`
                    : `/admin/events/${sub?.event_id}/sub-events/${sub?.id}`;

                  return (
                    <tr key={assignment.id} className="hover:bg-gray-50/80 transition">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className={`h-9 w-9 rounded-full flex items-center justify-center font-black text-xs ${
                            isFaculty ? 'bg-blue-100 text-kits-blue' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {coord.display_name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-gray-900">{coord.display_name}</div>
                            <div className="text-xs font-mono text-gray-500">@{coord.username}</div>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          isFaculty 
                            ? 'bg-blue-50 text-kits-blue border border-blue-200' 
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          {isFaculty ? <UserCheck className="h-3 w-3" /> : <GraduationCap className="h-3 w-3" />}
                          {isFaculty ? 'Faculty Coordinator' : 'Student Coordinator'}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        {coord.phone_number ? (
                          <div className="flex items-center gap-1.5 text-gray-700 font-mono text-xs">
                            <Phone className="h-3.5 w-3.5 text-gray-400" />
                            {coord.phone_number}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-xs italic">Not provided</span>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        {sub ? (
                          <div className="space-y-0.5">
                            <div className="font-bold text-gray-900 flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5 text-kits-red" />
                              {sub.name}
                            </div>
                            <div className="text-xs text-gray-500 flex items-center gap-1">
                              <Layers className="h-3 w-3 text-gray-400" />
                              {eventName} {categoryName && `› ${categoryName}`}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic text-xs">Unassigned</span>
                        )}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                          coord.status === 'ACTIVE' 
                            ? 'bg-green-50 text-green-700 border border-green-200' 
                            : 'bg-gray-100 text-gray-600 border border-gray-200'
                        }`}>
                          {coord.status}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-gray-600">
                        {formatDateTime12h(coord.created_at)}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right text-xs font-medium">
                        <div className="flex items-center justify-end gap-2">
                          {sub && (
                            <button
                              type="button"
                              onClick={() => navigate(subEventUrl)}
                              className="px-2.5 py-1 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition cursor-pointer"
                              title="Inspect Sub-Event"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setResetCoord({ id: coord.id, username: coord.username, display_name: coord.display_name });
                              setResetError(null);
                              setResetMessage(null);
                              setNewPassword('');
                              setConfirmPassword('');
                            }}
                            className="px-2.5 py-1 text-xs font-bold text-kits-blue bg-blue-50 hover:bg-blue-100 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
                            title="Reset Password"
                          >
                            <KeyRound className="h-3 w-3" />
                            <span>Reset</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setDeleteCoord({
                                id: coord.id,
                                username: coord.username,
                                display_name: coord.display_name,
                                assignmentCount: assignments.filter(a => a.coordinator_id === coord.id).length
                              });
                              setDeleteError(null);
                              setDeleteConfirmText('');
                            }}
                            className="px-2.5 py-1 text-xs font-bold text-kits-red bg-red-50 hover:bg-red-100 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
                            title="Delete Coordinator"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Export Coordinator Directory (Excel & PNG)
          ========================================================================= */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-5 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-red-50 text-kits-red flex items-center justify-center font-bold">
                  <Download className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                    Export Coordinator Directory
                  </h3>
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                    Administrative Records Export
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsExportModalOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {exportError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{exportError}</span>
              </div>
            )}

            {exportSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{exportSuccess}</span>
              </div>
            )}

            {/* Scope Selection */}
            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500">
                1. Select Export Scope
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setExportScope('FILTERED')}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    exportScope === 'FILTERED'
                      ? 'border-kits-blue bg-blue-50/60 ring-1 ring-kits-blue'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <p className="text-xs font-black text-gray-900">Current Filtered</p>
                  <p className="text-[10px] text-gray-500 mt-0.5 font-bold">
                    {filteredAssignments.length} record{filteredAssignments.length === 1 ? '' : 's'}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setExportScope('ENTIRE')}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    exportScope === 'ENTIRE'
                      ? 'border-kits-blue bg-blue-50/60 ring-1 ring-kits-blue'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <p className="text-xs font-black text-gray-900">Entire Directory</p>
                  <p className="text-[10px] text-gray-500 mt-0.5 font-bold">
                    {assignments.length} total record{assignments.length === 1 ? '' : 's'}
                  </p>
                </button>
              </div>
            </div>

            {/* Format Selection */}
            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500">
                2. Select File Format
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setExportFormat('EXCEL')}
                  className={`p-3.5 rounded-2xl border flex items-center gap-3 transition cursor-pointer ${
                    exportFormat === 'EXCEL'
                      ? 'border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600 text-emerald-950'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <FileSpreadsheet className="h-5 w-5 text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-xs font-black">Excel (.xlsx)</p>
                    <p className="text-[10px] text-gray-500">Spreadsheet table</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setExportFormat('PNG')}
                  className={`p-3.5 rounded-2xl border flex items-center gap-3 transition cursor-pointer ${
                    exportFormat === 'PNG'
                      ? 'border-kits-blue bg-blue-50/60 ring-1 ring-kits-blue text-blue-950'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <ImageIcon className="h-5 w-5 text-kits-blue shrink-0" />
                  <div>
                    <p className="text-xs font-black">Image (.png)</p>
                    <p className="text-[10px] text-gray-500">High-res document</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <DownloadButton
                onDownload={handleExecuteExport}
                label="Download Export"
                preparingLabel="Preparing Directory..."
                downloadingLabel={exportFormat === 'EXCEL' ? 'Generating Excel...' : 'Rendering PNG...'}
                completedLabel="Downloaded"
                variant="primary"
                size="md"
              />
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Reset Coordinator Password
          ========================================================================= */}
      {resetCoord && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-gray-200 modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-kits-blue" />
                <h3 className="text-sm font-black uppercase text-gray-900">
                  Reset Coordinator Password
                </h3>
              </div>
              <button onClick={() => setResetCoord(null)} className="p-1 hover:bg-gray-100 rounded-md cursor-pointer">
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1">
              <p className="font-bold text-gray-900">{resetCoord.display_name}</p>
              <p className="text-gray-500 font-mono">@{resetCoord.username}</p>
            </div>

            {resetError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                {resetError}
              </div>
            )}

            {resetMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{resetMessage}</span>
              </div>
            )}

            <form onSubmit={handleResetPasswordSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 mb-1">
                  New Password <span className="text-red-500">*</span>
                </label>
                <PasswordInput
                  required
                  autoComplete="new-password"
                  placeholder="Minimum 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 mb-1">
                  Confirm New Password <span className="text-red-500">*</span>
                </label>
                <PasswordInput
                  required
                  autoComplete="new-password"
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl text-gray-900 focus:ring-1 focus:ring-kits-blue focus:border-kits-blue"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setResetCoord(null)}
                  className="px-4 py-2 rounded-xl text-gray-600 hover:bg-gray-100 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="px-4 py-2 rounded-xl bg-kits-blue text-white font-black uppercase tracking-wider hover:bg-blue-800 transition cursor-pointer"
                >
                  {resetLoading ? 'Saving...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: Delete Coordinator
          ========================================================================= */}
      {deleteCoord && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl border border-red-200 modal-dialog-animate">
            <div className="flex items-center gap-2 text-kits-red border-b border-red-100 pb-3">
              <ShieldAlert className="h-6 w-6 shrink-0" />
              <h3 className="text-sm font-black uppercase tracking-wide text-red-900">
                Delete Coordinator
              </h3>
            </div>

            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 space-y-1">
              <p className="font-bold">Target Coordinator:</p>
              <p className="font-black text-gray-900">{deleteCoord.display_name} (@{deleteCoord.username})</p>
              <p className="text-[11px] text-gray-600 font-medium">
                Active Assignments: <span className="font-bold text-red-600">{deleteCoord.assignmentCount}</span>
              </p>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed font-normal">
              <strong>Warning:</strong> Deleting this coordinator will immediately remove all of their sub-event assignments.
            </p>

            {deleteError && (
              <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs text-red-900 font-bold">
                {deleteError}
              </div>
            )}

            <div className="space-y-2 text-xs">
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-600">
                To confirm, type <span className="font-mono text-red-600 font-black">DELETE</span> below:
              </label>
              <input
                type="text"
                placeholder="Type DELETE to confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full px-3.5 py-2 border border-red-300 rounded-xl font-mono text-gray-900 focus:ring-1 focus:ring-red-500 focus:border-red-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setDeleteCoord(null)}
                className="px-4 py-2 rounded-xl text-gray-600 hover:bg-gray-100 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <DeleteButton
                disabled={deleteConfirmText.trim() !== 'DELETE' || deleteLoading}
                loading={deleteLoading}
                onClick={handleDeleteCoordinatorSubmit}
                className="px-4 py-2 rounded-xl"
                label="Delete Coordinator"
                loadingLabel="Deleting..."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
