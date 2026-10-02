import React, { useState, useEffect } from 'react';
import type { 
  EventItem, 
  CategoryItem, 
  SubEventItem, 
  ParticipantRecord, 
  CoordinatorSession 
} from '../types';
import { 
  fetchActiveEvents, 
  fetchCategoriesForEvent, 
  fetchSubEventsForCategory, 
  fetchSubEventParticipants 
} from '../services/fallbackData';
import { validateCoordinatorCredentials, setStoredCoordinatorSession } from '../utils/authUtils';
import { exportParticipantsToCSV, exportParticipantsToExcel } from '../utils/exportUtils';
import { 
  Lock, 
  ShieldCheck, 
  Users, 
  Search, 
  FileSpreadsheet, 
  FileText, 
  Layers, 
  CheckCircle2, 
  AlertCircle, 
  MapPin, 
  Loader2,
  LogOut,
  UserCheck
} from 'lucide-react';

interface CoordinatorPortalProps {
  session: CoordinatorSession | null;
  onLoginSuccess: (session: CoordinatorSession) => void;
  onLogout: () => void;
}

export function CoordinatorPortal({
  session,
  onLoginSuccess,
  onLogout,
}: CoordinatorPortalProps) {
  // Login Form States
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Operational Data States
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<CategoryItem | null>(null);
  const [subEvents, setSubEvents] = useState<SubEventItem[]>([]);
  const [selectedSubEvent, setSelectedSubEvent] = useState<SubEventItem | null>(null);

  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [isEventsLoading, setIsEventsLoading] = useState(false);
  const [isSubsLoading, setIsSubsLoading] = useState(false);
  const [isRosterLoading, setIsRosterLoading] = useState(false);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'CONFIRMED' | 'PENDING_PAYMENT' | 'CANCELLED'>('ALL');
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // 1. Initial Load of all events if coordinator is authenticated
  useEffect(() => {
    if (!session?.isAuthenticated) return;

    let isMounted = true;
    setIsEventsLoading(true);

    fetchActiveEvents()
      .then((data) => {
        if (!isMounted) return;
        setEvents(data);
        if (data.length > 0) {
          setSelectedEvent(data[0]);
        }
      })
      .finally(() => {
        if (isMounted) setIsEventsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [session]);

  // 2. Load Categories when selectedEvent changes
  useEffect(() => {
    if (!selectedEvent) {
      setCategories([]);
      setSelectedCategory(null);
      return;
    }

    let isMounted = true;
    fetchCategoriesForEvent(selectedEvent.id).then((cats) => {
      if (!isMounted) return;
      setCategories(cats);
      if (cats.length > 0) {
        setSelectedCategory(cats[0]);
      } else {
        setSelectedCategory(null);
        setSubEvents([]);
        setSelectedSubEvent(null);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [selectedEvent]);

  // 3. Load Sub-Events when selectedCategory changes
  useEffect(() => {
    if (!selectedCategory) {
      setSubEvents([]);
      setSelectedSubEvent(null);
      return;
    }

    let isMounted = true;
    setIsSubsLoading(true);

    fetchSubEventsForCategory(selectedCategory.id)
      .then((subs) => {
        if (!isMounted) return;
        setSubEvents(subs);
        if (subs.length > 0) {
          setSelectedSubEvent(subs[0]);
        } else {
          setSelectedSubEvent(null);
          setParticipants([]);
        }
      })
      .finally(() => {
        if (isMounted) setIsSubsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedCategory]);

  // 4. Load Participant Roster when selectedSubEvent changes
  useEffect(() => {
    if (!selectedSubEvent) {
      setParticipants([]);
      return;
    }

    let isMounted = true;
    setIsRosterLoading(true);

    fetchSubEventParticipants(selectedSubEvent.id)
      .then((records) => {
        if (!isMounted) return;
        setParticipants(records);
      })
      .finally(() => {
        if (isMounted) setIsRosterLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedSubEvent]);

  // Handle Coordinator Login Form Submit
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthenticating(true);

    try {
      const isValid = await validateCoordinatorCredentials(usernameInput, passwordInput);

      if (isValid) {
        const newSession: CoordinatorSession = {
          isAuthenticated: true,
          role: 'FALLBACK_COORDINATOR',
          displayName: 'Operations Coordinator',
          loginTime: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        };

        setStoredCoordinatorSession(newSession);
        onLoginSuccess(newSession);
      } else {
        setAuthError('Invalid credentials. Please verify your username and password.');
      }
    } catch {
      setAuthError('An unexpected error occurred during authentication verification.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Filter Participants
  const filteredParticipants = participants.filter((p) => {
    // 1. Status Filter
    if (statusFilter !== 'ALL' && p.status !== statusFilter) {
      return false;
    }

    // 2. Search Query Filter
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase().trim();
    const nameMatch = p.student_name.toLowerCase().includes(query);
    const rollMatch = p.roll_number.toLowerCase().includes(query);
    const teamMatch = p.team_name ? p.team_name.toLowerCase().includes(query) : false;
    const collegeMatch = p.college.toLowerCase().includes(query);
    const deptMatch = p.department.toLowerCase().includes(query);

    // Also search individual team members if team
    const memberMatch = p.team_members
      ? p.team_members.some(
          (m) =>
            m.student_name.toLowerCase().includes(query) ||
            m.roll_number.toLowerCase().includes(query)
        )
      : false;

    return nameMatch || rollMatch || teamMatch || collegeMatch || deptMatch || memberMatch;
  });

  const handleDownloadCSV = () => {
    if (!selectedEvent || !selectedSubEvent || filteredParticipants.length === 0) return;
    exportParticipantsToCSV(selectedEvent.name, selectedSubEvent.name, filteredParticipants);
    setExportNotice('CSV download initiated successfully.');
    setTimeout(() => setExportNotice(null), 3000);
  };

  const handleDownloadExcel = () => {
    if (!selectedEvent || !selectedSubEvent || filteredParticipants.length === 0) return;
    exportParticipantsToExcel(selectedEvent.name, selectedSubEvent.name, filteredParticipants);
    setExportNotice('Excel spreadsheet (.xlsx) download initiated successfully.');
    setTimeout(() => setExportNotice(null), 3000);
  };

  // =========================================================================
  // VIEW A: COORDINATOR LOGIN INTERFACE
  // =========================================================================
  if (!session?.isAuthenticated) {
    return (
      <div className="max-w-md mx-auto py-10 space-y-6">
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-xl space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center mx-auto shadow-md">
              <Lock className="w-6 h-6 text-red-400" />
            </div>
            <h2 className="text-xl font-black text-gray-900 tracking-tight">
              Coordinator Portal Access
            </h2>
            <p className="text-xs text-gray-500 max-w-xs mx-auto">
              Authorized emergency operational continuity console for all institutional events.
            </p>
          </div>

          {/* Security Notice */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] text-slate-700 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              <strong>Read-Only Access:</strong> Unlocks live participant rosters and export tools across all active events without event ownership locks.
            </span>
          </div>

          {authError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-gray-700 block">
                Coordinator Username
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="Enter username"
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue font-medium"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-gray-700 block">
                Access Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue font-medium"
              />
            </div>

            <button
              type="submit"
              disabled={isAuthenticating}
              className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider transition shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isAuthenticating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Authenticate & Unlock All Rosters</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW B: AUTHENTICATED COORDINATOR PORTAL (READ-ONLY OPERATIONAL CONSOLE)
  // =========================================================================
  return (
    <div className="space-y-8">
      {/* 1. OPERATIONAL CONSOLE BANNER */}
      <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-7 shadow-lg border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-[10px] font-black uppercase tracking-wider border border-white/20">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Fallback Operational Console • All Events Unlocked</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight">
            Universal Participant Roster & Export Console
          </h2>
          <p className="text-xs text-slate-300">
            Authenticated as: <strong className="text-white">{session.displayName}</strong> • Strict Read-Only Operational Access
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onLogout}
            className="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>End Session</span>
          </button>
        </div>
      </div>

      {exportNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* 2. NAVIGATION HIERARCHY: EVENT -> CATEGORY -> SUB-EVENT */}
      <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-200 shadow-2xs space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Step 1: Select Event */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-slate-900 text-white text-[9px] flex items-center justify-center font-bold">1</span>
              <span>Flagship Event</span>
            </label>
            {isEventsLoading ? (
              <div className="p-2.5 bg-gray-50 rounded-xl text-xs text-gray-400">Loading events...</div>
            ) : (
              <select
                value={selectedEvent?.id || ''}
                onChange={(e) => {
                  const ev = events.find((item) => item.id === e.target.value);
                  setSelectedEvent(ev || null);
                }}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Step 2: Select Category Track */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-slate-900 text-white text-[9px] flex items-center justify-center font-bold">2</span>
              <span>Category Track</span>
            </label>
            {categories.length === 0 ? (
              <div className="p-2.5 bg-gray-50 rounded-xl text-xs text-gray-400">No categories found</div>
            ) : (
              <select
                value={selectedCategory?.id || ''}
                onChange={(e) => {
                  const cat = categories.find((item) => item.id === e.target.value);
                  setSelectedCategory(cat || null);
                }}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Step 3: Select Sub-Event */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-slate-900 text-white text-[9px] flex items-center justify-center font-bold">3</span>
              <span>Sub-Event</span>
            </label>
            {isSubsLoading ? (
              <div className="p-2.5 bg-gray-50 rounded-xl text-xs text-gray-400">Loading sub-events...</div>
            ) : subEvents.length === 0 ? (
              <div className="p-2.5 bg-gray-50 rounded-xl text-xs text-gray-400">No sub-events found</div>
            ) : (
              <select
                value={selectedSubEvent?.id || ''}
                onChange={(e) => {
                  const sub = subEvents.find((item) => item.id === e.target.value);
                  setSelectedSubEvent(sub || null);
                }}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
              >
                {subEvents.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name} ({sub.participation_type})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* 3. SUB-EVENT OPERATIONAL DASHBOARD & PARTICIPANT ROSTER */}
      {selectedSubEvent ? (
        <div className="bg-white rounded-3xl border border-gray-200 shadow-2xs overflow-hidden space-y-6 p-5 sm:p-7">
          {/* Sub-Event Header & Summary */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 pb-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-kits-blue text-[10px] font-black uppercase">
                  {selectedSubEvent.participation_type}
                </span>
                {selectedSubEvent.venue && (
                  <span className="flex items-center gap-1 text-[11px] text-gray-500 font-medium">
                    <MapPin className="w-3 h-3 text-gray-400" />
                    <span>{selectedSubEvent.venue}</span>
                  </span>
                )}
              </div>
              <h3 className="text-xl font-black text-gray-900">{selectedSubEvent.name}</h3>
              <p className="text-xs text-gray-500">
                Event: <span className="font-bold text-gray-700">{selectedEvent?.name}</span> • Track: <span className="font-bold text-gray-700">{selectedCategory?.name}</span>
              </p>
            </div>

            {/* Export Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadCSV}
                disabled={filteredParticipants.length === 0}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold transition flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5 text-gray-600" />
                <span>Download CSV</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadExcel}
                disabled={filteredParticipants.length === 0}
                className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black uppercase tracking-wider transition flex items-center gap-1.5 active:scale-95 disabled:opacity-50 shadow-2xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Download Excel (.xlsx)</span>
              </button>
            </div>
          </div>

          {/* Operational Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200">
              <div className="text-[10px] font-bold uppercase text-gray-400">Total Entries</div>
              <div className="text-lg font-black text-gray-900">{participants.length}</div>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200">
              <div className="text-[10px] font-bold uppercase text-emerald-700">Confirmed</div>
              <div className="text-lg font-black text-emerald-800">
                {participants.filter((p) => p.status === 'CONFIRMED').length}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200">
              <div className="text-[10px] font-bold uppercase text-amber-700">Pending Payment</div>
              <div className="text-lg font-black text-amber-800">
                {participants.filter((p) => p.status === 'PENDING_PAYMENT').length}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200">
              <div className="text-[10px] font-bold uppercase text-kits-blue">Mode</div>
              <div className="text-sm font-black text-kits-blue uppercase mt-1">
                {selectedSubEvent.participation_type}
              </div>
            </div>
          </div>

          {/* Search & Filter Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by student name, roll number, team..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-800 placeholder-gray-400 focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-gray-500">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800"
              >
                <option value="ALL">All Statuses</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="PENDING_PAYMENT">Pending Payment</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Live Participant Roster Table */}
          {isRosterLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-kits-blue" />
              <p className="text-xs font-bold text-gray-500">Retrieving live participant records...</p>
            </div>
          ) : filteredParticipants.length === 0 ? (
            <div className="p-12 text-center bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
              <Users className="w-10 h-10 text-gray-300 mx-auto" />
              <p className="text-sm font-bold text-gray-700">No participant records match current filters.</p>
              <p className="text-xs text-gray-400">
                {participants.length === 0 ? 'No registrations registered yet for this sub-event.' : 'Try adjusting search term or status filter.'}
              </p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100 text-gray-700 font-black border-b border-gray-200 text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-4">#</th>
                      <th className="py-3 px-4">Participant / Team</th>
                      <th className="py-3 px-4">Roll Number</th>
                      <th className="py-3 px-4">College / Institution</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredParticipants.map((p, idx) => (
                      <tr key={p.id} className="hover:bg-gray-50 transition">
                        <td className="py-3.5 px-4 font-mono text-gray-400 font-bold">{idx + 1}</td>

                        {/* Participant / Team details */}
                        <td className="py-3.5 px-4">
                          {p.registration_type === 'TEAM' ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1.5 font-black text-gray-900">
                                <Users className="w-3.5 h-3.5 text-kits-blue" />
                                <span>{p.team_name || 'Team Registration'}</span>
                              </div>
                              {p.team_members && p.team_members.length > 0 && (
                                <div className="space-y-1 pl-4 border-l-2 border-blue-100">
                                  {p.team_members.map((m) => (
                                    <div key={m.id} className="text-[11px] text-gray-600 flex items-center gap-1">
                                      <span className="font-bold text-gray-800">{m.student_name}</span>
                                      {m.is_leader && (
                                        <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                                          Leader
                                        </span>
                                      )}
                                      <span className="text-gray-400">({m.roll_number})</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="font-bold text-gray-900 flex items-center gap-1.5">
                              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                              <span>{p.student_name}</span>
                            </div>
                          )}
                        </td>

                        {/* Roll Number */}
                        <td className="py-3.5 px-4 font-mono font-bold text-gray-700">
                          {p.roll_number}
                        </td>

                        {/* College */}
                        <td className="py-3.5 px-4 text-gray-600 max-w-[200px] truncate">
                          {p.college}
                        </td>

                        {/* Department */}
                        <td className="py-3.5 px-4 font-medium text-gray-700">
                          {p.department}
                        </td>

                        {/* Status Badge */}
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                              p.status === 'CONFIRMED'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : p.status === 'PENDING_PAYMENT'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>

                        {/* Date */}
                        <td className="py-3.5 px-4 text-gray-500 text-[11px] font-medium">
                          {p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN') : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-12 text-center bg-white rounded-3xl border border-gray-200 space-y-2">
          <Layers className="w-10 h-10 text-gray-300 mx-auto" />
          <p className="text-sm font-bold text-gray-700">Select an event, category, and sub-event above.</p>
          <p className="text-xs text-gray-400">The participant roster will automatically load for the chosen track.</p>
        </div>
      )}
    </div>
  );
}
