import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@kits-eos/shared/src/api/client';
import { exportToExcel, exportTableToPNG } from '@kits-eos/shared/src/utils/export';
import { useScrollLock } from '@kits-eos/shared';
import { DownloadButton } from '../components/ui/DownloadButton';
import { 
  PhoneCall, 
  User, 
  Search, 
  Phone, 
  GraduationCap, 
  Briefcase, 
  Download, 
  X, 
  FileSpreadsheet, 
  Image as ImageIcon, 
  CheckCircle2, 
  AlertCircle,
  MapPin,
  Calendar,
  ChevronDown
} from 'lucide-react';
import { VenueDirectoryModal } from '../components/ui/VenueDirectoryModal';

interface MainEventOption {
  id: string;
  name: string;
  start_date: string | null;
  status: string;
}

interface CoordinatorContact {
  id: string;
  coordinator_id: string;
  display_name: string;
  coordinator_type: string;
  phone_number: string | null;
  sub_event_id: string;
  sub_event_name: string;
  category_name: string;
  event_name: string;
  event_id: string;
}

export function ContactCoordinators() {
  const [events, setEvents] = useState<MainEventOption[]>([]);
  const [selectedMainEventId, setSelectedMainEventId] = useState<string>('');
  const [coordinators, setCoordinators] = useState<CoordinatorContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'FACULTY' | 'STUDENT'>('ALL');

  // Export Modal States
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isVenueModalOpen, setIsVenueModalOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'FILTERED' | 'EVENT'>('FILTERED');
  const [exportFormat, setExportFormat] = useState<'EXCEL' | 'PNG'>('EXCEL');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  async function fetchEventsAndCoordinators(targetEventId?: string): Promise<CoordinatorContact[]> {
    try {
      setLoading(true);

      // 1. Fetch live active Main Events ordered chronologically if not yet loaded
      if (events.length === 0) {
        const { data: eventsData, error: eventsErr } = await supabase
          .from('events')
          .select('id, name, start_date, status')
          .eq('status', 'ACTIVE')
          .order('start_date', { ascending: true });

        if (!eventsErr && eventsData) {
          setEvents(eventsData as MainEventOption[]);
        }
      }

      const activeEventId = targetEventId !== undefined ? targetEventId : selectedMainEventId;

      if (!activeEventId) {
        setCoordinators([]);
        return [];
      }

      // 2. Fetch coordinator directory via public-safe RPC scoped to selected Main Event
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        'get_public_coordinator_directory',
        { p_event_id: activeEventId }
      );

      if (!rpcErr && Array.isArray(rpcData)) {
        const seenKeys = new Set<string>();
        const list: CoordinatorContact[] = [];

        for (const a of rpcData) {
          // Deduplicate join multiplication: each coordinator assignment / sub-event combination appears once
          const dedupeKey = `${a.coordinator_id}_${a.sub_event_id}`;
          if (seenKeys.has(dedupeKey)) continue;
          seenKeys.add(dedupeKey);

          list.push({
            id: a.assignment_id,
            coordinator_id: a.coordinator_id,
            display_name: a.display_name,
            coordinator_type: (a.coordinator_type || 'FACULTY').toUpperCase(),
            phone_number: a.phone_number,
            sub_event_id: a.sub_event_id,
            sub_event_name: (a.sub_event_name || 'General Event').trim().toUpperCase(),
            category_name: (a.category_name || 'GENERAL').trim().toUpperCase(),
            event_name: (a.event_name || 'KITS Event').trim().toUpperCase(),
            event_id: a.event_id,
          });
        }

        setCoordinators(list);
        return list;
      } else {
        if (rpcErr) {
          console.error('Failed to load coordinator directory:', rpcErr);
        }
        setCoordinators([]);
        return [];
      }
    } catch (err) {
      console.error('Failed to load coordinator directory:', err);
      setCoordinators([]);
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEventsAndCoordinators('');
  }, []);

  useEffect(() => {
    if (selectedMainEventId) {
      fetchEventsAndCoordinators(selectedMainEventId);
    } else {
      setCoordinators([]);
    }
  }, [selectedMainEventId]);

  // Safe scroll lock and Escape key when export modal is open
  useScrollLock(isExportModalOpen);

  useEffect(() => {
    if (!isExportModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExportModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExportModalOpen]);

  // Selected event metadata
  const selectedEvent = events.find((e) => e.id === selectedMainEventId);
  const selectedEventName = selectedEvent?.name || '';

  // 1. Filter coordinators by selected Main Event foreign key
  const eventCoordinators = selectedMainEventId
    ? coordinators.filter((c) => !c.event_id || c.event_id === selectedMainEventId)
    : [];

  // 2. Filter within selected event by search query and role filter
  const filteredCoordinators = eventCoordinators.filter((c) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q ||
      c.display_name.toLowerCase().includes(q) ||
      c.sub_event_name.toLowerCase().includes(q) ||
      c.category_name.toLowerCase().includes(q) ||
      c.event_name.toLowerCase().includes(q) ||
      (c.phone_number && c.phone_number.includes(q));

    const matchesRole = roleFilter === 'ALL' || c.coordinator_type === roleFilter;

    return matchesSearch && matchesRole;
  });

  // Handle Export Execution (Strictly scoped to the selected Main Event)
  const handleExecuteExport = async () => {
    try {
      if (!selectedMainEventId) {
        setExportError('Please select a Main Event first.');
        return;
      }

      setExportError(null);
      setExportSuccess(null);

      // Re-fetch latest authoritative data for fresh export
      const freshData = await fetchEventsAndCoordinators(selectedMainEventId);

      // Scoped strictly to the selected Main Event
      const currentEventCoords = freshData.length > 0
        ? freshData
        : coordinators.filter((c) => !c.event_id || c.event_id === selectedMainEventId);
      const currentFiltered = currentEventCoords.filter((c) => {
        const q = searchQuery.toLowerCase().trim();
        const matchesSearch = !q ||
          c.display_name.toLowerCase().includes(q) ||
          c.sub_event_name.toLowerCase().includes(q) ||
          c.category_name.toLowerCase().includes(q) ||
          c.event_name.toLowerCase().includes(q) ||
          (c.phone_number && c.phone_number.includes(q));

        const matchesRole = roleFilter === 'ALL' || c.coordinator_type === roleFilter;
        return matchesSearch && matchesRole;
      });

      const dataset = exportScope === 'FILTERED' ? currentFiltered : currentEventCoords;

      if (dataset.length === 0) {
        setExportError('No coordinator records match the selection.');
        return;
      }

      const headers = ['S.No', 'Coordinator Name', 'Role', 'Assigned Event', 'Category', 'Sub-Event', 'Mobile Number'];
      const rows = dataset.map((c, idx) => [
        idx + 1,
        c.display_name,
        c.coordinator_type === 'FACULTY' ? 'Faculty Coordinator' : 'Student Coordinator',
        c.event_name,
        c.category_name,
        c.sub_event_name,
        c.phone_number || 'N/A',
      ]);

      const dateStr = new Date().toISOString().split('T')[0];
      const safeEventName = selectedEventName ? selectedEventName.replace(/\s+/g, '_') : 'Event';

      if (exportFormat === 'EXCEL') {
        exportToExcel({
          filename: `KITS_EOS_Coordinators_${safeEventName}_${exportScope === 'FILTERED' ? 'Filtered_' : 'All_'}${dateStr}.xlsx`,
          title: `${selectedEventName.toUpperCase()} • COORDINATOR DIRECTORY`,
          subtitle: exportScope === 'FILTERED' 
            ? `Filtered (${dataset.length} Records)` 
            : `Event Directory (${dataset.length} Records)`,
          headers,
          rows,
          colWidths: [8, 24, 22, 22, 20, 20, 16],
        });
        setExportSuccess('Excel spreadsheet generated and downloaded successfully!');
      } else {
        await exportTableToPNG({
          filename: `KITS_EOS_Coordinators_${safeEventName}_${exportScope === 'FILTERED' ? 'Filtered_' : 'All_'}${dateStr}.png`,
          title: `${selectedEventName.toUpperCase()} • COORDINATOR DIRECTORY`,
          subtitle: exportScope === 'FILTERED' 
            ? `Filtered (${dataset.length} Records)` 
            : `Event Directory (${dataset.length} Records)`,
          headers,
          rows,
          colWidths: [8, 22, 20, 18, 16, 16, 16],
          rowsPerPage: 25,
        });
        setExportSuccess('PNG image table generated and downloaded successfully!');
      }

      setTimeout(() => {
        setIsExportModalOpen(false);
        setExportSuccess(null);
      }, 1800);
    } catch (err: any) {
      console.error('Export error:', err);
      setExportError(err.message || 'Failed to generate export file.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div className="bg-white rounded-3xl border border-gray-200 p-8 sm:p-10 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-black bg-red-50 text-kits-red border border-red-100 mb-2">
              <PhoneCall className="h-3.5 w-3.5" />
              <span>Official Event Directory</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight">
              Contact Event <span className="text-kits-red">Coordinators</span>
            </h1>
            <p className="text-sm text-gray-600 max-w-2xl leading-relaxed">
              Reach out to designated faculty advisors and student coordinators for sub-event schedules, 
              rules, team eligibility, and venue guidance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-center shrink-0">
            {/* Action: VIEW / DOWNLOAD VENUE LIST */}
            <button
              type="button"
              onClick={() => setIsVenueModalOpen(true)}
              disabled={!selectedMainEventId}
              title={selectedMainEventId ? `View venue and coordinator list for ${selectedEventName}` : 'Select a Main Event first'}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-kits-red disabled:active:scale-100"
            >
              <MapPin className="h-4 w-4 text-white" />
              <span>View / Download Venue List</span>
            </button>

            {/* Export Directory button */}
            <button
              type="button"
              onClick={() => {
                setIsExportModalOpen(true);
                setExportError(null);
                setExportSuccess(null);
              }}
              disabled={!selectedMainEventId}
              title={selectedMainEventId ? `Export coordinators for ${selectedEventName}` : 'Select a Main Event first'}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-wider hover:bg-gray-800 active:scale-95 transition shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-900 disabled:active:scale-100"
            >
              <Download className="h-4 w-4 text-kits-blue" />
              <span>Export Directory</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-2xs space-y-4">
        {/* Main Event Selector (Prominent Dropdown at the Top) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 pb-3.5 border-b border-gray-100">
          <label 
            htmlFor="main-event-select" 
            className="text-[11px] font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5 shrink-0"
          >
            <Calendar className="h-3.5 w-3.5 text-kits-red" />
            <span>MAIN EVENT</span>
          </label>
          <div className="relative flex-1 w-full max-w-md">
            <select
              id="main-event-select"
              value={selectedMainEventId}
              onChange={(e) => setSelectedMainEventId(e.target.value)}
              className="w-full pl-3.5 pr-10 py-2.5 bg-gray-50 hover:bg-white text-xs font-bold text-gray-900 border border-gray-300 rounded-xl focus:ring-2 focus:ring-kits-red/20 focus:border-kits-red transition cursor-pointer appearance-none shadow-2xs"
            >
              <option value="">Select Main Event</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3.5 top-3 h-4 w-4 text-gray-500 pointer-events-none" />
          </div>
          {selectedMainEventId && selectedEvent && (
            <span className="text-[11px] text-gray-500 font-semibold hidden md:inline-block">
              Showing coordinators for <strong className="text-gray-900">{selectedEvent.name}</strong>
            </span>
          )}
        </div>

        {/* Search and Role Filter Bar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by coordinator name, sub-event, category, or event..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={!selectedMainEventId}
              className="w-full pl-10 pr-4 py-2.5 text-xs border border-gray-300 rounded-xl text-gray-900 focus:ring-2 focus:ring-kits-blue/20 focus:border-kits-blue disabled:opacity-50 disabled:bg-gray-50 disabled:cursor-not-allowed transition"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setRoleFilter('ALL')}
              disabled={!selectedMainEventId}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                roleFilter === 'ALL'
                  ? 'bg-gray-900 text-white shadow-2xs'
                  : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              All Roles
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter('FACULTY')}
              disabled={!selectedMainEventId}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                roleFilter === 'FACULTY'
                  ? 'bg-kits-red text-white shadow-2xs'
                  : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              Faculty Only
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter('STUDENT')}
              disabled={!selectedMainEventId}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                roleFilter === 'STUDENT'
                  ? 'bg-kits-blue text-white shadow-2xs'
                  : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              Student Leads Only
            </button>
          </div>
        </div>
      </div>

      {/* Coordinator Content Area */}
      {loading ? (
        <div className="py-16 text-center text-xs text-gray-400 font-bold flex flex-col items-center justify-center gap-2 bg-white rounded-2xl border border-gray-200">
          <div className="h-6 w-6 border-2 border-kits-red border-t-transparent rounded-full animate-spin" />
          <span>Loading event directory...</span>
        </div>
      ) : !selectedMainEventId ? (
        /* Empty State 1: Before Main Event Selection */
        <div className="p-12 sm:p-16 text-center bg-white rounded-2xl border border-gray-200 shadow-2xs space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-red-50 text-kits-red flex items-center justify-center mx-auto mb-2">
            <Calendar className="h-6 w-6" />
          </div>
          <h3 className="text-base font-black text-gray-900 tracking-tight">
            Select a Main Event to view its coordinators.
          </h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
            Please choose an active flagship event from the dropdown above to view its designated faculty advisors and student coordinators.
          </p>
        </div>
      ) : eventCoordinators.length === 0 ? (
        /* Empty State 2: Selected event has no coordinators */
        <div className="p-12 sm:p-16 text-center bg-white rounded-2xl border border-gray-200 shadow-2xs space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-2">
            <User className="h-6 w-6" />
          </div>
          <h3 className="text-base font-black text-gray-900 tracking-tight">
            No coordinators assigned to this Main Event yet.
          </h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
            Coordinator assignments for <strong className="text-gray-700">{selectedEventName}</strong> are currently in preparation. Please check back shortly.
          </p>
        </div>
      ) : filteredCoordinators.length === 0 ? (
        /* Empty State 3: Filter/search within event has no results */
        <div className="p-12 sm:p-16 text-center bg-white rounded-2xl border border-gray-200 shadow-2xs space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-2">
            <Search className="h-6 w-6" />
          </div>
          <h3 className="text-base font-black text-gray-900 tracking-tight">
            No coordinators match your current filters.
          </h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
            Try adjusting your search query or clearing your role filter for {selectedEventName}.
          </p>
          {(searchQuery || roleFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setRoleFilter('ALL');
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold transition cursor-pointer mt-2"
            >
              <span>Reset Search &amp; Filters</span>
            </button>
          )}
        </div>
      ) : (
        /* Coordinator Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCoordinators.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs hover:border-gray-300 card-hover-interactive transition space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded flex items-center gap-1 ${
                      c.coordinator_type === 'FACULTY'
                        ? 'bg-red-50 text-kits-red border border-red-100'
                        : 'bg-blue-50 text-kits-blue border border-blue-100'
                    }`}
                  >
                    {c.coordinator_type === 'FACULTY' ? (
                      <>
                        <Briefcase className="h-3 w-3" />
                        <span>Faculty Coordinator</span>
                      </>
                    ) : (
                      <>
                        <GraduationCap className="h-3 w-3" />
                        <span>Student Coordinator</span>
                      </>
                    )}
                  </span>
                </div>

                <div>
                  <h3 className="text-base font-black text-gray-900 tracking-tight capitalize">
                    {c.display_name}
                  </h3>
                  <div className="space-y-0.5 mt-1 text-[11px] text-gray-500">
                    <p className="font-semibold text-gray-700">
                      Sub-Event: <span className="text-kits-blue uppercase font-bold">{c.sub_event_name}</span>
                    </p>
                    <p className="text-gray-500">
                      Category: {c.category_name}
                    </p>
                    <p className="text-gray-400">
                      Event: {c.event_name}
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100">
                {c.phone_number ? (
                  <a
                    href={`tel:${c.phone_number}`}
                    className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-xs font-mono font-bold text-gray-900 transition"
                  >
                    <Phone className="h-3.5 w-3.5 text-kits-red" />
                    <span>{c.phone_number}</span>
                  </a>
                ) : (
                  <div className="text-center text-[10px] text-gray-400 font-semibold py-1">
                    Contact via Sub-event desk at venue
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* =========================================================================
          EXPORT COORDINATOR DIRECTORY MODAL
          ========================================================================= */}
      {isExportModalOpen && createPortal(
        <div 
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 modal-overlay-animate overflow-hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsExportModalOpen(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-md w-full p-4 sm:p-7 space-y-4 sm:space-y-5 shadow-2xl border border-gray-200 modal-dialog-animate max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
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
                    {selectedEventName || 'Official KITS-EOS Export'}
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

            {/* Error / Success feedback */}
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
                1. Select Export Scope ({selectedEventName})
              </label>
              <div className="grid grid-cols-1 xs:grid-cols-2 gap-2">
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
                    {filteredCoordinators.length} record{filteredCoordinators.length === 1 ? '' : 's'}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setExportScope('EVENT')}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    exportScope === 'EVENT'
                      ? 'border-kits-blue bg-blue-50/60 ring-1 ring-kits-blue'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <p className="text-xs font-black text-gray-900">All Event Coordinators</p>
                  <p className="text-[10px] text-gray-500 mt-0.5 font-bold">
                    {eventCoordinators.length} total record{eventCoordinators.length === 1 ? '' : 's'}
                  </p>
                </button>
              </div>
            </div>

            {/* Format Selection */}
            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500">
                2. Select File Format
              </label>
              <div className="grid grid-cols-1 xs:grid-cols-2 gap-2">
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
            <div className="flex flex-col-reverse xs:flex-row xs:items-center xs:justify-end gap-2 pt-3 border-t border-gray-100 w-full">
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="w-full xs:w-auto px-4 py-2.5 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition cursor-pointer text-center"
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
                className="w-full xs:w-auto"
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Venue & Coordinator Directory Modal */}
      <VenueDirectoryModal
        isOpen={isVenueModalOpen}
        onClose={() => setIsVenueModalOpen(false)}
        mainEventId={selectedMainEventId}
        mainEventName={selectedEventName}
      />
    </div>
  );
}
